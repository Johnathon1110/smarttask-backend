const express = require('express');

const { sql, getPool } = require('../config/db');
const { authMiddleware, allowRoles } = require('../middleware/auth.middleware');

const router = express.Router();

function parseJsonArray(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(value)
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function getMatchedSkills(workerSkills, requiredSkills) {
  if (!Array.isArray(workerSkills) || !Array.isArray(requiredSkills)) {
    return [];
  }

  const workerSet = new Set(
    workerSkills.map((skill) => normalizeText(skill))
  );

  return requiredSkills.filter((skill) =>
    workerSet.has(normalizeText(skill))
  );
}

function calculateMatchScore(workerSkills, requiredSkills) {
  if (!Array.isArray(requiredSkills) || requiredSkills.length === 0) {
    return 0;
  }

  const matchedSkills = getMatchedSkills(workerSkills, requiredSkills);

  return Math.round((matchedSkills.length / requiredSkills.length) * 100);
}

function buildMatchData(worker, task) {
  const workerSkills = parseJsonArray(worker.skills);
  const requiredSkills = parseJsonArray(task.requiredSkills);
  const matchedSkills = getMatchedSkills(workerSkills, requiredSkills);
  const matchScore = calculateMatchScore(workerSkills, requiredSkills);

  return {
    matchScore,
    matchedSkills,
    matchReason: `${matchedSkills.length} of ${requiredSkills.length} required skills matched`
  };
}

function formatTask(row, matchData = null) {
  const task = {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    type: row.type,
    location: row.location,
    budget: row.budget !== undefined && row.budget !== null ? Number(row.budget) : 0,
    date: row.date,
    ownerId: row.ownerId,
    requiredSkills: parseJsonArray(row.requiredSkills),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };

  if (matchData) {
    task.matchScore = matchData.matchScore;
    task.matchedSkills = matchData.matchedSkills;
    task.matchReason = matchData.matchReason;
  }

  return task;
}

function formatWorker(row, matchData = null) {
  const worker = {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    role: row.role,
    phone: row.phone,
    location: row.location,
    skills: parseJsonArray(row.skills),
    experience: row.experience,
    rating: row.rating
  };

  if (matchData) {
    worker.matchScore = matchData.matchScore;
    worker.matchedSkills = matchData.matchedSkills;
    worker.matchReason = matchData.matchReason;
  }

  return worker;
}

router.get('/tasks', authMiddleware, allowRoles('worker'), async (req, res) => {
  try {
    const pool = await getPool();

    const workerResult = await pool.request()
      .input('workerId', sql.Int, req.user.id)
      .query(`
        SELECT
          id,
          fullName,
          email,
          role,
          phone,
          location,
          skills,
          experience,
          rating
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

    const worker = workerResult.recordset[0];

    const tasksResult = await pool.request()
      .input('workerId', sql.Int, req.user.id)
      .query(`
        SELECT t.*
        FROM Tasks t
        WHERE t.status = 'open'
          AND NOT EXISTS (
            SELECT 1
            FROM Applications a
            WHERE a.taskId = t.id
              AND a.workerId = @workerId
          )
        ORDER BY t.id DESC
      `);

    const matchedTasks = tasksResult.recordset
      .map((task) => {
        const matchData = buildMatchData(worker, task);
        return formatTask(task, matchData);
      })
      .filter((task) => task.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore);

    return res.json({
      success: true,
      recommendations: matchedTasks
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to get matched tasks',
      error: error.message
    });
  }
});

router.get('/workers/:taskId', authMiddleware, allowRoles('owner'), async (req, res) => {
  try {
    const taskId = Number(req.params.taskId);

    if (!Number.isInteger(taskId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid task id'
      });
    }

    const pool = await getPool();

    const taskResult = await pool.request()
      .input('taskId', sql.Int, taskId)
      .input('ownerId', sql.Int, req.user.id)
      .query(`
        SELECT *
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

    const workersResult = await pool.request()
      .input('taskId', sql.Int, taskId)
      .query(`
        SELECT
          id,
          fullName,
          email,
          role,
          phone,
          location,
          skills,
          experience,
          rating
        FROM Users
        WHERE role = 'worker'
          AND NOT EXISTS (
            SELECT 1
            FROM Applications a
            WHERE a.taskId = @taskId
              AND a.workerId = Users.id
              AND a.status IN ('accepted', 'rejected')
          )
      `);

    const matchedWorkers = workersResult.recordset
      .map((worker) => {
        const matchData = buildMatchData(worker, task);
        return formatWorker(worker, matchData);
      })
      .filter((worker) => worker.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore);

    return res.json({
      success: true,
      task: formatTask(task),
      recommendations: matchedWorkers
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to get matched workers',
      error: error.message
    });
  }
});

module.exports = router;