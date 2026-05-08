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
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    type: row.type,
    location: row.location,
    budget: Number(row.budget),
    date: row.date,
    ownerId: row.ownerId,
    requiredSkills: parseJsonArray(row.requiredSkills),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

/**
 * POST /api/tasks
 * Owner only: creates a new task.
 */
router.post('/', authMiddleware, allowRoles('owner'), async (req, res) => {
  try {
    const {
      title,
      description,
      category,
      type,
      location,
      budget,
      date,
      requiredSkills
    } = req.body;

    if (!title || !description || !category || !type || !location || !budget || !date) {
      return res.status(400).json({
        success: false,
        message: 'title, description, category, type, location, budget, and date are required'
      });
    }

    if (!['physical', 'remote'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task type'
      });
    }

    const skillsJson = Array.isArray(requiredSkills)
      ? JSON.stringify(requiredSkills)
      : JSON.stringify([]);

    const pool = await getPool();

    const result = await pool.request()
      .input('title', sql.NVarChar(200), title)
      .input('description', sql.NVarChar(sql.MAX), description)
      .input('category', sql.NVarChar(100), category)
      .input('type', sql.NVarChar(20), type)
      .input('location', sql.NVarChar(150), location)
      .input('budget', sql.Decimal(10, 2), Number(budget))
      .input('date', sql.NVarChar(50), date)
      .input('ownerId', sql.Int, req.user.id)
      .input('requiredSkills', sql.NVarChar(sql.MAX), skillsJson)
      .query(`
        INSERT INTO Tasks (
          title,
          description,
          category,
          type,
          location,
          budget,
          date,
          ownerId,
          requiredSkills,
          status
        )
        OUTPUT INSERTED.*
        VALUES (
          @title,
          @description,
          @category,
          @type,
          @location,
          @budget,
          @date,
          @ownerId,
          @requiredSkills,
          'open'
        )
      `);

    return res.status(201).json({
      success: true,
      message: 'Task created successfully',
      task: formatTask(result.recordset[0])
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to create task',
      error: error.message
    });
  }
});

/**
 * GET /api/tasks
 * Returns open tasks by default.
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT *
      FROM Tasks
      WHERE status = 'open'
      ORDER BY id DESC
    `);

    return res.json({
      success: true,
      tasks: result.recordset.map(formatTask)
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
 * GET /api/tasks/owner/my-tasks
 * Owner only: returns tasks created by the logged-in owner.
 *
 * Important: this route must be before /:id.
 */
router.get('/owner/my-tasks', authMiddleware, allowRoles('owner'), async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request()
      .input('ownerId', sql.Int, req.user.id)
      .query(`
        SELECT *
        FROM Tasks
        WHERE ownerId = @ownerId
        ORDER BY id DESC
      `);

    return res.json({
      success: true,
      tasks: result.recordset.map(formatTask)
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to get owner tasks',
      error: error.message
    });
  }
});

/**
 * GET /api/tasks/:id
 * Returns one task by id.
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const taskId = Number(req.params.id);

    if (!Number.isInteger(taskId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task id'
      });
    }

    const pool = await getPool();

    const result = await pool.request()
      .input('id', sql.Int, taskId)
      .query(`
        SELECT *
        FROM Tasks
        WHERE id = @id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Task not found'
      });
    }

    return res.json({
      success: true,
      task: formatTask(result.recordset[0])
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to get task',
      error: error.message
    });
  }
});

/**
 * PUT /api/tasks/:id
 * Owner only: updates a task created by the logged-in owner.
 */
router.put('/:id', authMiddleware, allowRoles('owner'), async (req, res) => {
  try {
    const taskId = Number(req.params.id);

    if (!Number.isInteger(taskId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task id'
      });
    }

    const {
      title,
      description,
      category,
      type,
      location,
      budget,
      date,
      requiredSkills
    } = req.body;

    if (type && !['physical', 'remote'].includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task type'
      });
    }

    const skillsJson = Array.isArray(requiredSkills)
      ? JSON.stringify(requiredSkills)
      : null;

    const pool = await getPool();

    const result = await pool.request()
      .input('id', sql.Int, taskId)
      .input('ownerId', sql.Int, req.user.id)
      .input('title', sql.NVarChar(200), title || null)
      .input('description', sql.NVarChar(sql.MAX), description || null)
      .input('category', sql.NVarChar(100), category || null)
      .input('type', sql.NVarChar(20), type || null)
      .input('location', sql.NVarChar(150), location || null)
      .input('budget', sql.Decimal(10, 2), budget !== undefined ? Number(budget) : null)
      .input('date', sql.NVarChar(50), date || null)
      .input('requiredSkills', sql.NVarChar(sql.MAX), skillsJson)
      .query(`
        UPDATE Tasks
        SET
          title = COALESCE(@title, title),
          description = COALESCE(@description, description),
          category = COALESCE(@category, category),
          type = COALESCE(@type, type),
          location = COALESCE(@location, location),
          budget = COALESCE(@budget, budget),
          date = COALESCE(@date, date),
          requiredSkills = COALESCE(@requiredSkills, requiredSkills),
          updatedAt = SYSDATETIME()
        OUTPUT INSERTED.*
        WHERE id = @id AND ownerId = @ownerId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Task not found or you do not own this task'
      });
    }

    return res.json({
      success: true,
      message: 'Task updated successfully',
      task: formatTask(result.recordset[0])
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to update task',
      error: error.message
    });
  }
});

/**
 * PATCH /api/tasks/:id/status
 * Owner only: updates task status.
 */
router.patch('/:id/status', authMiddleware, allowRoles('owner'), async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const { status } = req.body;

    if (!Number.isInteger(taskId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task id'
      });
    }

    if (!['open', 'in-progress', 'completed'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task status'
      });
    }

    const pool = await getPool();

    const result = await pool.request()
      .input('id', sql.Int, taskId)
      .input('ownerId', sql.Int, req.user.id)
      .input('status', sql.NVarChar(30), status)
      .query(`
        UPDATE Tasks
        SET status = @status,
            updatedAt = SYSDATETIME()
        OUTPUT INSERTED.*
        WHERE id = @id AND ownerId = @ownerId
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Task not found or you do not own this task'
      });
    }

    return res.json({
      success: true,
      message: 'Task status updated successfully',
      task: formatTask(result.recordset[0])
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to update task status',
      error: error.message
    });
  }
});

module.exports = router;