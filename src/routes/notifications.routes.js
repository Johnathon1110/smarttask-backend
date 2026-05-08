const express = require('express');

const { sql, getPool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth.middleware');

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