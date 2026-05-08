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

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Skills are the main factor.
 * Score: up to 70 points.
 */
function calculateSkillsScore(workerSkills, requiredSkills) {
  if (!Array.isArray(requiredSkills) || requiredSkills.length === 0) {
    return 40;
  }

  if (!Array.isArray(workerSkills) || workerSkills.length === 0) {
    return 0;
  }

  const workerSet = new Set(
    workerSkills.map(skill => normalizeText(skill))
  );

  const matchedCount = requiredSkills.filter(skill =>
    workerSet.has(normalizeText(skill))
  ).length;

  return Math.round((matchedCount / requiredSkills.length) * 70);
}

/**
 * Location is a bonus factor.
 * Score: up to 10 points.
 * Remote tasks automatically get location points.
 */
function calculateLocationScore(workerLocation, taskLocation, taskType) {
  if (taskType === 'remote') {
    return 10;
  }

  if (!workerLocation || !taskLocation) {
    return 0;
  }

  return normalizeText(workerLocation) === normalizeText(taskLocation) ? 10 : 0;
}

/**
 * Availability is a bonus factor.
 * Score: 10 points if the worker has availability.
 */
function calculateAvailabilityScore(availability) {
  return availability ? 10 : 0;
}

/**
 * Rating is a bonus factor.
 * Score: up to 10 points.
 */
function calculateRatingScore(rating) {
  const numericRating = Number(rating || 0);

  if (numericRating <= 0) return 0;

  return Math.round((Math.min(numericRating, 5) / 5) * 10);
}

/**
 * Total match score out of 100:
 * Skills      = 70
 * Location    = 10
 * Availability= 10
 * Rating      = 10
 */
function calculateMatchScore({ worker, task }) {
  const workerSkills = parseJsonArray(worker.skills);
  const requiredSkills = parseJsonArray(task.requiredSkills);

  const skillsScore = calculateSkillsScore(workerSkills, requiredSkills);
  const locationScore = calculateLocationScore(worker.location, task.location, task.type);
  const availabilityScore = calculateAvailabilityScore(worker.availability);
  const ratingScore = calculateRatingScore(worker.rating);

  const total = skillsScore + locationScore + availabilityScore + ratingScore;

  return Math.min(total, 100);
}

function formatTask(row, matchScore = null) {
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

  if (matchScore !== null) {
    task.matchScore = matchScore;
  }

  return task;
}

function formatWorker(row, matchScore = null) {
  const worker = {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    role: row.role,
    phone: row.phone,
    location: row.location,
    skills: parseJsonArray(row.skills),
    experience: row.experience,
    availability: row.availability,
    rating: row.rating
  };

  if (matchScore !== null) {
    worker.matchScore = matchScore;
  }

  return worker;
}

/**
 * GET /api/recommendations/tasks
 *
 * Worker only.
 * Returns recommended open tasks for the logged-in worker.
 */
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
          availability,
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

    const recommendedTasks = tasksResult.recordset
      .map(task => {
        const matchScore = calculateMatchScore({
          worker,
          task
        });

        return formatTask(task, matchScore);
      })
      .sort((a, b) => b.matchScore - a.matchScore);

    return res.json({
      success: true,
      recommendations: recommendedTasks
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to get recommended tasks',
      error: error.message
    });
  }
});

/**
 * GET /api/recommendations/workers/:taskId
 *
 * Owner only.
 * Returns recommended workers for one task.
 */
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
          availability,
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

    const recommendedWorkers = workersResult.recordset
      .map(worker => {
        const matchScore = calculateMatchScore({
          worker,
          task
        });

        return formatWorker(worker, matchScore);
      })
      .sort((a, b) => b.matchScore - a.matchScore);

    return res.json({
      success: true,
      task: formatTask(task),
      recommendations: recommendedWorkers
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to get recommended workers',
      error: error.message
    });
  }
});

module.exports = router;