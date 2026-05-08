const express = require('express');

const { sql, getPool } = require('../config/db');
const { authMiddleware, allowRoles } = require('../middleware/auth.middleware');

const router = express.Router();

/**
 * GET /api/admin/stats
 * Admin only: returns dashboard statistics.
 */
router.get('/stats', authMiddleware, allowRoles('admin'), async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM Users) AS totalUsers,
        (SELECT COUNT(*) FROM Users WHERE role = 'worker') AS totalWorkers,
        (SELECT COUNT(*) FROM Users WHERE role = 'owner') AS totalOwners,
        (SELECT COUNT(*) FROM Users WHERE role = 'admin') AS totalAdmins,

        (SELECT COUNT(*) FROM Tasks) AS totalTasks,
        (SELECT COUNT(*) FROM Tasks WHERE status = 'open') AS openTasks,
        (SELECT COUNT(*) FROM Tasks WHERE status = 'in-progress') AS inProgressTasks,
        (SELECT COUNT(*) FROM Tasks WHERE status = 'completed') AS completedTasks,

        (SELECT COUNT(*) FROM Applications) AS totalApplications,
        (SELECT COUNT(*) FROM Applications WHERE status = 'pending') AS pendingApplications,
        (SELECT COUNT(*) FROM Applications WHERE status = 'accepted') AS acceptedApplications,
        (SELECT COUNT(*) FROM Applications WHERE status = 'rejected') AS rejectedApplications,

        (SELECT COUNT(*) FROM Reviews) AS totalReviews,
        (SELECT COUNT(*) FROM Notifications) AS totalNotifications,
        (SELECT COUNT(*) FROM ChatConversations) AS totalConversations,
        (SELECT COUNT(*) FROM ChatMessages) AS totalMessages
    `);

    return res.json({
      success: true,
      stats: result.recordset[0]
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to get admin stats',
      error: error.message
    });
  }
});

/**
 * GET /api/admin/users
 * Admin only: returns all users.
 */
router.get('/users', authMiddleware, allowRoles('admin'), async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT
        id,
        fullName,
        email,
        role,
        phone,
        location,
        skills,
        experience,
        availability,
        rating,
        createdAt,
        updatedAt
      FROM Users
      ORDER BY id ASC
    `);

    const users = result.recordset.map((user) => ({
      ...user,
      skills: parseJsonArray(user.skills)
    }));

    return res.json({
      success: true,
      users
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to get users',
      error: error.message
    });
  }
});

/**
 * GET /api/admin/tasks
 * Admin only: returns all tasks.
 */
router.get('/tasks', authMiddleware, allowRoles('admin'), async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT
        id,
        title,
        description,
        category,
        type,
        location,
        budget,
        date,
        ownerId,
        requiredSkills,
        status,
        createdAt,
        updatedAt
      FROM Tasks
      ORDER BY id DESC
    `);

    const tasks = result.recordset.map((task) => ({
      ...task,
      budget: task.budget !== null && task.budget !== undefined ? Number(task.budget) : 0,
      requiredSkills: parseJsonArray(task.requiredSkills)
    }));

    return res.json({
      success: true,
      tasks
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to get tasks',
      error: error.message
    });
  }
});

/**
 * DELETE /api/admin/users/:id
 * Admin only: deletes a non-admin user and related records.
 */
router.delete('/users/:id', authMiddleware, allowRoles('admin'), async (req, res) => {
  const userId = Number(req.params.id);

  if (!Number.isInteger(userId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid user id'
    });
  }

  try {
    const pool = await getPool();

    const userResult = await pool.request()
      .input('userId', sql.Int, userId)
      .query(`
        SELECT id, role
        FROM Users
        WHERE id = @userId
      `);

    if (userResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = userResult.recordset[0];

    if (user.role === 'admin') {
      return res.status(400).json({
        success: false,
        message: 'Admin account cannot be removed'
      });
    }

    const transaction = new sql.Transaction(pool);

    await transaction.begin();

    try {
      const request = new sql.Request(transaction);

      await request
        .input('userId', sql.Int, userId)
        .query(`
          DELETE FROM ChatMessages
          WHERE conversationId IN (
            SELECT id
            FROM ChatConversations
            WHERE ownerId = @userId
               OR workerId = @userId
               OR taskId IN (
                 SELECT id
                 FROM Tasks
                 WHERE ownerId = @userId
               )
          );

          DELETE FROM ChatConversations
          WHERE ownerId = @userId
             OR workerId = @userId
             OR taskId IN (
               SELECT id
               FROM Tasks
               WHERE ownerId = @userId
             );

          DELETE FROM Reviews
          WHERE reviewerId = @userId
             OR revieweeId = @userId
             OR taskId IN (
               SELECT id
               FROM Tasks
               WHERE ownerId = @userId
             );

          DELETE FROM Applications
          WHERE workerId = @userId
             OR taskId IN (
               SELECT id
               FROM Tasks
               WHERE ownerId = @userId
             );

          DELETE FROM Notifications
          WHERE userId = @userId;

          DELETE FROM Tasks
          WHERE ownerId = @userId;

          DELETE FROM Users
          WHERE id = @userId;
        `);

      await transaction.commit();

      return res.json({
        success: true,
        message: 'User removed successfully'
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to remove user',
      error: error.message
    });
  }
});

/**
 * DELETE /api/admin/tasks/:id
 * Admin only: deletes a task and related records.
 */
router.delete('/tasks/:id', authMiddleware, allowRoles('admin'), async (req, res) => {
  const taskId = Number(req.params.id);

  if (!Number.isInteger(taskId)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid task id'
    });
  }

  try {
    const pool = await getPool();

    const taskResult = await pool.request()
      .input('taskId', sql.Int, taskId)
      .query(`
        SELECT id
        FROM Tasks
        WHERE id = @taskId
      `);

    if (taskResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    const transaction = new sql.Transaction(pool);

    await transaction.begin();

    try {
      const request = new sql.Request(transaction);

      await request
        .input('taskId', sql.Int, taskId)
        .query(`
          DELETE FROM ChatMessages
          WHERE conversationId IN (
            SELECT id
            FROM ChatConversations
            WHERE taskId = @taskId
          );

          DELETE FROM ChatConversations
          WHERE taskId = @taskId;

          DELETE FROM Reviews
          WHERE taskId = @taskId;

          DELETE FROM Applications
          WHERE taskId = @taskId;

          DELETE FROM Tasks
          WHERE id = @taskId;
        `);

      await transaction.commit();

      return res.json({
        success: true,
        message: 'Task removed successfully'
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to remove task',
      error: error.message
    });
  }
});

function parseJsonArray(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

module.exports = router;