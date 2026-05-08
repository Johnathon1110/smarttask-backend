const express = require('express');

const { sql, getPool } = require('../config/db');
const { authMiddleware, allowRoles } = require('../middleware/auth.middleware');

const router = express.Router();

function formatReview(row) {
  if (!row) return null;

  const review = {
    id: row.id,
    reviewerId: row.reviewerId,
    revieweeId: row.revieweeId,
    taskId: row.taskId,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.createdAt
  };

  if (row.reviewerFullName) {
    review.reviewer = {
      id: row.reviewerId,
      fullName: row.reviewerFullName,
      email: row.reviewerEmail,
      role: row.reviewerRole
    };
  }

  if (row.revieweeFullName) {
    review.reviewee = {
      id: row.revieweeId,
      fullName: row.revieweeFullName,
      email: row.revieweeEmail,
      role: row.revieweeRole
    };
  }

  if (row.taskTitle) {
    review.task = {
      id: row.taskId,
      title: row.taskTitle
    };
  }

  return review;
}

/**
 * POST /api/reviews
 *
 * Owner only.
 * Creates a review from owner to worker.
 *
 * If taskId is 0 or missing, the backend automatically finds
 * the latest accepted task between this owner and this worker.
 */
router.post('/', authMiddleware, allowRoles('owner'), async (req, res) => {
  try {
    const {
      revieweeId,
      taskId,
      rating,
      comment
    } = req.body;

    if (!revieweeId || !rating) {
      return res.status(400).json({
        success: false,
        message: 'revieweeId and rating are required'
      });
    }

    const workerId = Number(revieweeId);
    const numericRating = Number(rating);
    let finalTaskId = Number(taskId || 0);

    if (!Number.isInteger(workerId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid revieweeId'
      });
    }

    if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be an integer between 1 and 5'
      });
    }

    if (workerId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot review yourself'
      });
    }

    const pool = await getPool();

    const workerCheck = await pool.request()
      .input('workerId', sql.Int, workerId)
      .query(`
        SELECT id, role
        FROM Users
        WHERE id = @workerId AND role = 'worker'
      `);

    if (workerCheck.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Worker not found'
      });
    }

    if (!Number.isInteger(finalTaskId) || finalTaskId <= 0) {
      const acceptedTaskResult = await pool.request()
        .input('ownerId', sql.Int, req.user.id)
        .input('workerId', sql.Int, workerId)
        .query(`
          SELECT TOP 1
            t.id AS taskId
          FROM Applications a
          INNER JOIN Tasks t ON a.taskId = t.id
          WHERE t.ownerId = @ownerId
            AND a.workerId = @workerId
            AND a.status = 'accepted'
          ORDER BY a.appliedAt DESC
        `);

      if (acceptedTaskResult.recordset.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'You can only review a worker after accepting them for a task'
        });
      }

      finalTaskId = acceptedTaskResult.recordset[0].taskId;
    }

    const relationCheck = await pool.request()
      .input('taskId', sql.Int, finalTaskId)
      .input('ownerId', sql.Int, req.user.id)
      .input('workerId', sql.Int, workerId)
      .query(`
        SELECT TOP 1 a.id
        FROM Applications a
        INNER JOIN Tasks t ON a.taskId = t.id
        WHERE a.taskId = @taskId
          AND t.ownerId = @ownerId
          AND a.workerId = @workerId
          AND a.status = 'accepted'
      `);

    if (relationCheck.recordset.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'You can only review a worker accepted for your task'
      });
    }

    const duplicateCheck = await pool.request()
      .input('reviewerId', sql.Int, req.user.id)
      .input('revieweeId', sql.Int, workerId)
      .input('taskId', sql.Int, finalTaskId)
      .query(`
        SELECT id
        FROM Reviews
        WHERE reviewerId = @reviewerId
          AND revieweeId = @revieweeId
          AND taskId = @taskId
      `);

    if (duplicateCheck.recordset.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'You already reviewed this worker for this task'
      });
    }

    const transaction = new sql.Transaction(pool);

    await transaction.begin();

    try {
      const createReviewRequest = new sql.Request(transaction);

      const result = await createReviewRequest
        .input('reviewerId', sql.Int, req.user.id)
        .input('revieweeId', sql.Int, workerId)
        .input('taskId', sql.Int, finalTaskId)
        .input('rating', sql.Int, numericRating)
        .input('comment', sql.NVarChar(sql.MAX), comment || null)
        .query(`
          INSERT INTO Reviews (
            reviewerId,
            revieweeId,
            taskId,
            rating,
            comment
          )
          OUTPUT INSERTED.*
          VALUES (
            @reviewerId,
            @revieweeId,
            @taskId,
            @rating,
            @comment
          )
        `);

      const updateRatingRequest = new sql.Request(transaction);

      await updateRatingRequest
        .input('workerId', sql.Int, workerId)
        .query(`
          UPDATE Users
          SET rating = (
            SELECT AVG(CAST(rating AS FLOAT))
            FROM Reviews
            WHERE revieweeId = @workerId
          ),
          updatedAt = SYSDATETIME()
          WHERE id = @workerId
        `);

      const notificationRequest = new sql.Request(transaction);

      await notificationRequest
        .input('userId', sql.Int, workerId)
        .input('title', sql.NVarChar(200), 'New Review Received')
        .input('message', sql.NVarChar(sql.MAX), 'You received a new review from a task owner.')
        .query(`
          INSERT INTO Notifications (userId, title, message)
          VALUES (@userId, @title, @message)
        `);

      await transaction.commit();

      return res.status(201).json({
        success: true,
        message: 'Review created successfully',
        review: formatReview(result.recordset[0])
      });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to create review',
      error: error.message
    });
  }
});

/**
 * GET /api/reviews/user/:userId
 * Returns reviews received by one worker/user.
 */
router.get('/user/:userId', authMiddleware, async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    if (!Number.isInteger(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user id'
      });
    }

    const pool = await getPool();

    const result = await pool.request()
      .input('userId', sql.Int, userId)
      .query(`
        SELECT
          r.id,
          r.reviewerId,
          r.revieweeId,
          r.taskId,
          r.rating,
          r.comment,
          r.createdAt,

          reviewer.fullName AS reviewerFullName,
          reviewer.email AS reviewerEmail,
          reviewer.role AS reviewerRole,

          reviewee.fullName AS revieweeFullName,
          reviewee.email AS revieweeEmail,
          reviewee.role AS revieweeRole,

          t.title AS taskTitle
        FROM Reviews r
        INNER JOIN Users reviewer ON r.reviewerId = reviewer.id
        INNER JOIN Users reviewee ON r.revieweeId = reviewee.id
        INNER JOIN Tasks t ON r.taskId = t.id
        WHERE r.revieweeId = @userId
        ORDER BY r.createdAt DESC
      `);

    return res.json({
      success: true,
      reviews: result.recordset.map(formatReview)
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to get reviews',
      error: error.message
    });
  }
});

module.exports = router;