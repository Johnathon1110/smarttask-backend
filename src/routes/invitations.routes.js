const express = require('express');

const { sql, getPool } = require('../config/db');
const { authMiddleware, allowRoles } = require('../middleware/auth.middleware');

const router = express.Router();

function formatInvitation(row) {
  if (!row) return null;

  return {
    id: row.id,
    taskId: row.taskId,
    ownerId: row.ownerId,
    workerId: row.workerId,
    status: row.status,
    createdAt: row.createdAt,
    respondedAt: row.respondedAt,
    task: row.taskTitle
      ? {
          id: row.taskId,
          title: row.taskTitle,
          description: row.taskDescription,
          category: row.taskCategory,
          type: row.taskType,
          location: row.taskLocation,
          budget: row.taskBudget !== null && row.taskBudget !== undefined ? Number(row.taskBudget) : 0,
          date: row.taskDate,
          status: row.taskStatus
        }
      : undefined,
    owner: row.ownerFullName
      ? {
          id: row.ownerId,
          fullName: row.ownerFullName,
          email: row.ownerEmail
        }
      : undefined,
    worker: row.workerFullName
      ? {
          id: row.workerId,
          fullName: row.workerFullName,
          email: row.workerEmail
        }
      : undefined
  };
}

/**
 * POST /api/invitations
 * Owner only: creates a task invitation for a worker.
 */
router.post('/', authMiddleware, allowRoles('owner'), async (req, res) => {
  try {
    const taskId = Number(req.body.taskId);
    const workerId = Number(req.body.workerId);

    if (!Number.isInteger(taskId) || !Number.isInteger(workerId)) {
      return res.status(400).json({
        success: false,
        message: 'Valid taskId and workerId are required'
      });
    }

    const pool = await getPool();

    const taskResult = await pool.request()
      .input('taskId', sql.Int, taskId)
      .input('ownerId', sql.Int, req.user.id)
      .query(`
        SELECT id, title, ownerId, status
        FROM Tasks
        WHERE id = @taskId
          AND ownerId = @ownerId
      `);

    if (taskResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Task not found or you do not own this task'
      });
    }

    const task = taskResult.recordset[0];

    if (task.status !== 'open') {
      return res.status(400).json({
        success: false,
        message: 'Invitations can only be sent for open tasks'
      });
    }

    const workerResult = await pool.request()
      .input('workerId', sql.Int, workerId)
      .query(`
        SELECT id, fullName, role
        FROM Users
        WHERE id = @workerId
          AND role = 'worker'
      `);

    if (workerResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found'
      });
    }

    const existingApplication = await pool.request()
      .input('taskId', sql.Int, taskId)
      .input('workerId', sql.Int, workerId)
      .query(`
        SELECT id
        FROM Applications
        WHERE taskId = @taskId
          AND workerId = @workerId
      `);

    if (existingApplication.recordset.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'This worker has already applied to this task'
      });
    }

    const existingInvitation = await pool.request()
      .input('taskId', sql.Int, taskId)
      .input('workerId', sql.Int, workerId)
      .query(`
        SELECT id, status
        FROM TaskInvitations
        WHERE taskId = @taskId
          AND workerId = @workerId
      `);

    if (existingInvitation.recordset.length > 0) {
      return res.json({
        success: true,
        message: 'This worker has already been invited to this task.',
        invitation: existingInvitation.recordset[0]
      });
    }

    const transaction = new sql.Transaction(pool);

    await transaction.begin();

    try {
      const invitationRequest = new sql.Request(transaction);

      const invitationResult = await invitationRequest
        .input('taskId', sql.Int, taskId)
        .input('ownerId', sql.Int, req.user.id)
        .input('workerId', sql.Int, workerId)
        .query(`
          INSERT INTO TaskInvitations (
            taskId,
            ownerId,
            workerId,
            status
          )
          OUTPUT INSERTED.*
          VALUES (
            @taskId,
            @ownerId,
            @workerId,
            'pending'
          )
        `);

      const notificationRequest = new sql.Request(transaction);

      await notificationRequest
        .input('userId', sql.Int, workerId)
        .input('title', sql.NVarChar(200), 'Task Invitation')
        .input('message', sql.NVarChar(sql.MAX), `You have been invited to work on task: ${task.title}`)
        .query(`
          INSERT INTO Notifications (userId, title, message)
          VALUES (@userId, @title, @message)
        `);

      await transaction.commit();

      return res.status(201).json({
        success: true,
        message: 'Invitation sent successfully.',
        invitation: formatInvitation(invitationResult.recordset[0])
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to send invitation',
      error: error.message
    });
  }
});

/**
 * GET /api/invitations/my
 * Worker only: gets invitations for the logged-in worker.
 */
router.get('/my', authMiddleware, allowRoles('worker'), async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request()
      .input('workerId', sql.Int, req.user.id)
      .query(`
        SELECT
          i.id,
          i.taskId,
          i.ownerId,
          i.workerId,
          i.status,
          i.createdAt,
          i.respondedAt,

          t.title AS taskTitle,
          t.description AS taskDescription,
          t.category AS taskCategory,
          t.type AS taskType,
          t.location AS taskLocation,
          t.budget AS taskBudget,
          t.date AS taskDate,
          t.status AS taskStatus,

          owner.fullName AS ownerFullName,
          owner.email AS ownerEmail
        FROM TaskInvitations i
        INNER JOIN Tasks t ON i.taskId = t.id
        INNER JOIN Users owner ON i.ownerId = owner.id
        WHERE i.workerId = @workerId
        ORDER BY i.createdAt DESC
      `);

    return res.json({
      success: true,
      invitations: result.recordset.map(formatInvitation)
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to get invitations',
      error: error.message
    });
  }
});

/**
 * PATCH /api/invitations/:id/respond
 * Worker only: accepts or rejects an invitation.
 */
router.patch('/:id/respond', authMiddleware, allowRoles('worker'), async (req, res) => {
  try {
    const invitationId = Number(req.params.id);
    const { status } = req.body;

    if (!Number.isInteger(invitationId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid invitation id'
      });
    }

    if (!['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be accepted or rejected'
      });
    }

    const pool = await getPool();

    const invitationResult = await pool.request()
      .input('invitationId', sql.Int, invitationId)
      .input('workerId', sql.Int, req.user.id)
      .query(`
        SELECT
          i.id,
          i.taskId,
          i.ownerId,
          i.workerId,
          i.status,
          t.title AS taskTitle,
          t.status AS taskStatus
        FROM TaskInvitations i
        INNER JOIN Tasks t ON i.taskId = t.id
        WHERE i.id = @invitationId
          AND i.workerId = @workerId
      `);

    if (invitationResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Invitation not found'
      });
    }

    const invitation = invitationResult.recordset[0];

    if (invitation.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'This invitation has already been responded to'
      });
    }

    if (status === 'accepted' && invitation.taskStatus !== 'open') {
      return res.status(400).json({
        success: false,
        message: 'This task is no longer open'
      });
    }

    const transaction = new sql.Transaction(pool);

    await transaction.begin();

    try {
      const updateInvitationRequest = new sql.Request(transaction);

      const updatedInvitation = await updateInvitationRequest
        .input('invitationId', sql.Int, invitationId)
        .input('status', sql.NVarChar(30), status)
        .query(`
          UPDATE TaskInvitations
          SET status = @status,
              respondedAt = SYSDATETIME()
          OUTPUT INSERTED.*
          WHERE id = @invitationId
        `);

      if (status === 'accepted') {
        const existingApplicationRequest = new sql.Request(transaction);

        const existingApplication = await existingApplicationRequest
          .input('taskId', sql.Int, invitation.taskId)
          .input('workerId', sql.Int, invitation.workerId)
          .query(`
            SELECT id
            FROM Applications
            WHERE taskId = @taskId
              AND workerId = @workerId
          `);

        if (existingApplication.recordset.length === 0) {
          const createApplicationRequest = new sql.Request(transaction);

          await createApplicationRequest
            .input('taskId', sql.Int, invitation.taskId)
            .input('workerId', sql.Int, invitation.workerId)
            .input('coverLetter', sql.NVarChar(sql.MAX), 'Accepted task invitation.')
            .query(`
              INSERT INTO Applications (
                taskId,
                workerId,
                coverLetter,
                status
              )
              VALUES (
                @taskId,
                @workerId,
                @coverLetter,
                'accepted'
              )
            `);
        } else {
          const updateApplicationRequest = new sql.Request(transaction);

          await updateApplicationRequest
            .input('taskId', sql.Int, invitation.taskId)
            .input('workerId', sql.Int, invitation.workerId)
            .query(`
              UPDATE Applications
              SET status = 'accepted'
              WHERE taskId = @taskId
                AND workerId = @workerId
            `);
        }

        const updateTaskRequest = new sql.Request(transaction);

        await updateTaskRequest
          .input('taskId', sql.Int, invitation.taskId)
          .query(`
            UPDATE Tasks
            SET status = 'in-progress',
                updatedAt = SYSDATETIME()
            WHERE id = @taskId
          `);

        const rejectOtherApplicationsRequest = new sql.Request(transaction);

        await rejectOtherApplicationsRequest
          .input('taskId', sql.Int, invitation.taskId)
          .input('workerId', sql.Int, invitation.workerId)
          .query(`
            UPDATE Applications
            SET status = 'rejected'
            WHERE taskId = @taskId
              AND workerId <> @workerId
              AND status = 'pending'
          `);

        const existingConversationRequest = new sql.Request(transaction);

        const existingConversation = await existingConversationRequest
          .input('taskId', sql.Int, invitation.taskId)
          .input('ownerId', sql.Int, invitation.ownerId)
          .input('workerId', sql.Int, invitation.workerId)
          .query(`
            SELECT id
            FROM ChatConversations
            WHERE taskId = @taskId
              AND ownerId = @ownerId
              AND workerId = @workerId
          `);

        if (existingConversation.recordset.length === 0) {
          const createConversationRequest = new sql.Request(transaction);

          await createConversationRequest
            .input('taskId', sql.Int, invitation.taskId)
            .input('ownerId', sql.Int, invitation.ownerId)
            .input('workerId', sql.Int, invitation.workerId)
            .query(`
              INSERT INTO ChatConversations (
                taskId,
                ownerId,
                workerId
              )
              VALUES (
                @taskId,
                @ownerId,
                @workerId
              )
            `);
        }
      }

      const ownerNotificationTitle = status === 'accepted'
        ? 'Invitation Accepted'
        : 'Invitation Rejected';

      const ownerNotificationMessage = status === 'accepted'
        ? `A worker accepted your invitation and chat is now available for task: ${invitation.taskTitle}`
        : `A worker rejected your invitation for task: ${invitation.taskTitle}`;

      const ownerNotificationRequest = new sql.Request(transaction);

      await ownerNotificationRequest
        .input('userId', sql.Int, invitation.ownerId)
        .input('title', sql.NVarChar(200), ownerNotificationTitle)
        .input('message', sql.NVarChar(sql.MAX), ownerNotificationMessage)
        .query(`
          INSERT INTO Notifications (userId, title, message)
          VALUES (@userId, @title, @message)
        `);

      await transaction.commit();

      return res.json({
        success: true,
        message: status === 'accepted'
          ? 'Invitation accepted successfully. Chat is now available.'
          : 'Invitation rejected successfully.',
        invitation: formatInvitation(updatedInvitation.recordset[0])
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to respond to invitation',
      error: error.message
    });
  }
});

module.exports = router;