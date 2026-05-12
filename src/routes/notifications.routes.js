const express = require('express');

const { sql, getPool } = require('../config/db');
const { authMiddleware, allowRoles } = require('../middleware/auth.middleware');

const router = express.Router();

function formatNotification(row) {
  if (!row) return null;

  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    message: row.message,
    createdAt: row.createdAt,
    read: Boolean(row.isRead)
  };
}

/**
 * GET /api/notifications
 * Returns notifications for the logged-in user.
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request()
      .input('userId', sql.Int, req.user.id)
      .query(`
        SELECT id, userId, title, message, createdAt, isRead
        FROM Notifications
        WHERE userId = @userId
        ORDER BY createdAt DESC
      `);

    return res.json({
      success: true,
      notifications: result.recordset.map(formatNotification)
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to get notifications',
      error: error.message
    });
  }
});

/**
 * POST /api/notifications/invite-worker
 * Owner only: sends an invitation notification to a matched worker.
 */
router.post('/invite-worker', authMiddleware, allowRoles('owner'), async (req, res) => {
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
        SELECT id, title, ownerId
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

    const task = taskResult.recordset[0];

    const title = 'Task Invitation';
    const message = `You have been invited to apply for task: ${task.title}`;

    const duplicateCheck = await pool.request()
      .input('userId', sql.Int, workerId)
      .input('title', sql.NVarChar(200), title)
      .input('message', sql.NVarChar(sql.MAX), message)
      .query(`
        SELECT TOP 1 id
        FROM Notifications
        WHERE userId = @userId
          AND title = @title
          AND message = @message
        ORDER BY id DESC
      `);

    if (duplicateCheck.recordset.length > 0) {
      return res.json({
        success: true,
        message: 'Worker has already been invited to this task.'
      });
    }

    const result = await pool.request()
      .input('userId', sql.Int, workerId)
      .input('title', sql.NVarChar(200), title)
      .input('message', sql.NVarChar(sql.MAX), message)
      .query(`
        INSERT INTO Notifications (userId, title, message)
        OUTPUT INSERTED.id, INSERTED.userId, INSERTED.title,
               INSERTED.message, INSERTED.createdAt, INSERTED.isRead
        VALUES (@userId, @title, @message)
      `);

    return res.status(201).json({
      success: true,
      message: 'Invitation sent successfully.',
      notification: formatNotification(result.recordset[0])
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to invite worker',
      error: error.message
    });
  }
});

/**
 * PATCH /api/notifications/:id/read
 * Marks one notification as read.
 */
router.patch('/:id/read', authMiddleware, async (req, res) => {
  try {
    const notificationId = Number(req.params.id);

    if (!Number.isInteger(notificationId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification id'
      });
    }

    const pool = await getPool();

    const result = await pool.request()
      .input('id', sql.Int, notificationId)
      .input('userId', sql.Int, req.user.id)
      .query(`
        UPDATE Notifications
        SET isRead = 1
        OUTPUT INSERTED.id, INSERTED.userId, INSERTED.title,
               INSERTED.message, INSERTED.createdAt, INSERTED.isRead
        WHERE id = @id AND userId = @userId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    return res.json({
      success: true,
      message: 'Notification marked as read',
      notification: formatNotification(result.recordset[0])
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read',
      error: error.message
    });
  }
});

module.exports = router;