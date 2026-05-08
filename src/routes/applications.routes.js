const express = require('express');

const { sql, getPool } = require('../config/db');
const { authMiddleware, allowRoles } = require('../middleware/auth.middleware');

const router = express.Router();

function parseJsonArray(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatTask(row) {
  if (!row) return null;

  return {
    id: row.taskId || row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    type: row.type,
    location: row.location,
    budget: row.budget !== undefined && row.budget !== null ? Number(row.budget) : undefined,
    date: row.date,
    ownerId: row.ownerId,
    requiredSkills: parseJsonArray(row.requiredSkills),
    status: row.taskStatus || row.status
  };
}

function formatWorker(row) {
  if (!row) return null;

  return {
    id: row.workerUserId,
    fullName: row.workerFullName,
    email: row.workerEmail,
    role: 'worker',
    phone: row.workerPhone,
    location: row.workerLocation,
    skills: parseJsonArray(row.workerSkills),
    experience: row.workerExperience,
    availability: row.workerAvailability,
    rating: row.workerRating
  };
}

function formatApplication(row) {
  const application = {
    id: row.id,
    taskId: row.taskId,
    workerId: row.workerId,
    coverLetter: row.coverLetter,
    status: row.status,
    appliedAt: row.appliedAt
  };

  if (row.title) {
    application.task = formatTask(row);
  }

  if (row.workerFullName) {
    application.worker = formatWorker(row);
  }

  return application;
}

/**
 * POST /api/applications
 * Worker only: applies to an open task.
 */
router.post('/', authMiddleware, allowRoles('worker'), async (req, res) => {
  try {
    const { taskId, coverLetter } = req.body;

    if (!taskId) {
      return res.status(400).json({
        success: false,
        message: 'taskId is required'
      });
    }

    const pool = await getPool();

    const taskResult = await pool.request()
      .input('taskId', sql.Int, Number(taskId))
      .query(`
        SELECT id, status
        FROM Tasks
        WHERE id = @taskId
      `);

    if (taskResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    if (taskResult.recordset[0].status !== 'open') {
      return res.status(400).json({
        success: false,
        message: 'You can only apply to open tasks'
      });
    }

    const result = await pool.request()
      .input('taskId', sql.Int, Number(taskId))
      .input('workerId', sql.Int, req.user.id)
      .input('coverLetter', sql.NVarChar(sql.MAX), coverLetter || null)
      .query(`
        INSERT INTO Applications (
          taskId,
          workerId,
          coverLetter,
          status
        )
        OUTPUT INSERTED.*
        VALUES (
          @taskId,
          @workerId,
          @coverLetter,
          'pending'
        )
      `);

    return res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      application: formatApplication(result.recordset[0])
    });
  } catch (error) {
    if (error.number === 2627 || error.number === 2601) {
      return res.status(409).json({
        success: false,
        message: 'You already applied to this task'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to submit application',
      error: error.message
    });
  }
});

/**
 * GET /api/applications/my
 * Worker only: returns applications submitted by the logged-in worker.
 */
router.get('/my', authMiddleware, allowRoles('worker'), async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request()
      .input('workerId', sql.Int, req.user.id)
      .query(`
        SELECT
          a.id,
          a.taskId,
          a.workerId,
          a.coverLetter,
          a.status,
          a.appliedAt,

          t.id AS taskId,
          t.title,
          t.description,
          t.category,
          t.type,
          t.location,
          t.budget,
          t.date,
          t.ownerId,
          t.requiredSkills,
          t.status AS taskStatus
        FROM Applications a
        INNER JOIN Tasks t ON a.taskId = t.id
        WHERE a.workerId = @workerId
        ORDER BY a.id DESC
      `);

    return res.json({
      success: true,
      applications: result.recordset.map(formatApplication)
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to get applications',
      error: error.message
    });
  }
});

/**
 * GET /api/applications/task/:taskId
 * Owner only: returns applications submitted to one of the owner's tasks.
 */
router.get('/task/:taskId', authMiddleware, allowRoles('owner'), async (req, res) => {
  try {
    const taskId = Number(req.params.taskId);

    if (!Number.isInteger(taskId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task id'
      });
    }

    const pool = await getPool();

    const ownerCheck = await pool.request()
      .input('taskId', sql.Int, taskId)
      .input('ownerId', sql.Int, req.user.id)
      .query(`
        SELECT id
        FROM Tasks
        WHERE id = @taskId AND ownerId = @ownerId
      `);

    if (ownerCheck.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Task not found or you do not own this task'
      });
    }

    const result = await pool.request()
      .input('taskId', sql.Int, taskId)
      .query(`
        SELECT
          a.id,
          a.taskId,
          a.workerId,
          a.coverLetter,
          a.status,
          a.appliedAt,

          u.id AS workerUserId,
          u.fullName AS workerFullName,
          u.email AS workerEmail,
          u.phone AS workerPhone,
          u.location AS workerLocation,
          u.skills AS workerSkills,
          u.experience AS workerExperience,
          u.availability AS workerAvailability,
          u.rating AS workerRating
        FROM Applications a
        INNER JOIN Users u ON a.workerId = u.id
        WHERE a.taskId = @taskId
        ORDER BY a.id DESC
      `);

    return res.json({
      success: true,
      applications: result.recordset.map(formatApplication)
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to get task applications',
      error: error.message
    });
  }
});

/**
 * PATCH /api/applications/:id/status
 * Owner only: accepts or rejects an application.
 */
router.patch('/:id/status', authMiddleware, allowRoles('owner'), async (req, res) => {
  try {
    const applicationId = Number(req.params.id);
    const { status } = req.body;

    if (!Number.isInteger(applicationId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid application id'
      });
    }

    if (!['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be accepted or rejected'
      });
    }

    const pool = await getPool();

    const appCheck = await pool.request()
      .input('applicationId', sql.Int, applicationId)
      .input('ownerId', sql.Int, req.user.id)
      .query(`
        SELECT
          a.id,
          a.taskId,
          a.workerId,
          a.status,
          t.ownerId
        FROM Applications a
        INNER JOIN Tasks t ON a.taskId = t.id
        WHERE a.id = @applicationId AND t.ownerId = @ownerId
      `);

    if (appCheck.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Application not found or you do not own this task'
      });
    }

    const appRow = appCheck.recordset[0];

    const transaction = new sql.Transaction(pool);

    await transaction.begin();

    try {
      const updateApplicationRequest = new sql.Request(transaction);

      const updatedApplication = await updateApplicationRequest
        .input('applicationId', sql.Int, applicationId)
        .input('status', sql.NVarChar(30), status)
        .query(`
          UPDATE Applications
          SET status = @status
          OUTPUT INSERTED.*
          WHERE id = @applicationId
        `);

      if (status === 'accepted') {
        const updateTaskRequest = new sql.Request(transaction);

        await updateTaskRequest
          .input('taskId', sql.Int, appRow.taskId)
          .query(`
            UPDATE Tasks
            SET status = 'in-progress',
                updatedAt = SYSDATETIME()
            WHERE id = @taskId
          `);

        const rejectOthersRequest = new sql.Request(transaction);

        await rejectOthersRequest
          .input('taskId', sql.Int, appRow.taskId)
          .input('applicationId', sql.Int, applicationId)
          .query(`
            UPDATE Applications
            SET status = 'rejected'
            WHERE taskId = @taskId
              AND id <> @applicationId
              AND status = 'pending'
          `);
      }

      const notificationTitle = status === 'accepted'
        ? 'Application Accepted'
        : 'Application Rejected';

      const notificationMessage = status === 'accepted'
        ? 'Your application has been accepted.'
        : 'Your application has been rejected.';

      const createNotificationRequest = new sql.Request(transaction);

      await createNotificationRequest
        .input('userId', sql.Int, appRow.workerId)
        .input('title', sql.NVarChar(200), notificationTitle)
        .input('message', sql.NVarChar(sql.MAX), notificationMessage)
        .query(`
          INSERT INTO Notifications (userId, title, message)
          VALUES (@userId, @title, @message)
        `);

      await transaction.commit();

      return res.json({
        success: true,
        message: `Application ${status} successfully`,
        application: formatApplication(updatedApplication.recordset[0])
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to update application status',
      error: error.message
    });
  }
});

module.exports = router;