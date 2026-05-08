const express = require('express');

const { sql, getPool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth.middleware');

const router = express.Router();

function formatConversation(row) {
  if (!row) return null;

  return {
    id: row.id,
    taskId: row.taskId,
    ownerId: row.ownerId,
    workerId: row.workerId,
    createdAt: row.createdAt,
    task: row.taskTitle
      ? {
          id: row.taskId,
          title: row.taskTitle,
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
      : undefined,
    lastMessage: row.lastMessage || null,
    lastMessageAt: row.lastMessageAt || null
  };
}

function formatMessage(row) {
  if (!row) return null;

  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    message: row.message,
    createdAt: row.createdAt,
    sender: row.senderFullName
      ? {
          id: row.senderId,
          fullName: row.senderFullName,
          email: row.senderEmail,
          role: row.senderRole
        }
      : undefined
  };
}

/**
 * POST /api/chat/conversations
 *
 * Creates or returns an existing conversation for an accepted task.
 * Body:
 * {
 *   "taskId": 1,
 *   "workerId": 1
 * }
 */
router.post('/conversations', authMiddleware, async (req, res) => {
  try {
    const { taskId, workerId } = req.body;

    const numericTaskId = Number(taskId);
    const numericWorkerId = Number(workerId);

    if (!Number.isInteger(numericTaskId) || !Number.isInteger(numericWorkerId)) {
      return res.status(400).json({
        success: false,
        message: 'Valid taskId and workerId are required'
      });
    }

    const pool = await getPool();

    const relationResult = await pool.request()
      .input('taskId', sql.Int, numericTaskId)
      .input('workerId', sql.Int, numericWorkerId)
      .query(`
        SELECT
          t.id AS taskId,
          t.ownerId,
          a.workerId
        FROM Tasks t
        INNER JOIN Applications a ON a.taskId = t.id
        WHERE t.id = @taskId
          AND a.workerId = @workerId
          AND a.status = 'accepted'
      `);

    if (relationResult.recordset.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Conversation can only be created for an accepted task'
      });
    }

    const relation = relationResult.recordset[0];

    if (req.user.id !== relation.ownerId && req.user.id !== relation.workerId) {
      return res.status(403).json({
        success: false,
        message: 'You are not allowed to create this conversation'
      });
    }

    const existingConversation = await pool.request()
      .input('taskId', sql.Int, numericTaskId)
      .input('ownerId', sql.Int, relation.ownerId)
      .input('workerId', sql.Int, relation.workerId)
      .query(`
        SELECT *
        FROM ChatConversations
        WHERE taskId = @taskId
          AND ownerId = @ownerId
          AND workerId = @workerId
      `);

    if (existingConversation.recordset.length > 0) {
      return res.json({
        success: true,
        message: 'Conversation already exists',
        conversation: formatConversation(existingConversation.recordset[0])
      });
    }

    const result = await pool.request()
      .input('taskId', sql.Int, numericTaskId)
      .input('ownerId', sql.Int, relation.ownerId)
      .input('workerId', sql.Int, relation.workerId)
      .query(`
        INSERT INTO ChatConversations (
          taskId,
          ownerId,
          workerId
        )
        OUTPUT INSERTED.*
        VALUES (
          @taskId,
          @ownerId,
          @workerId
        )
      `);

    return res.status(201).json({
      success: true,
      message: 'Conversation created successfully',
      conversation: formatConversation(result.recordset[0])
    });
  } catch (error) {
    if (error.number === 2627 || error.number === 2601) {
      return res.status(409).json({
        success: false,
        message: 'Conversation already exists'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to create conversation',
      error: error.message
    });
  }
});

/**
 * GET /api/chat/conversations
 *
 * Returns conversations for the logged-in user.
 */
router.get('/conversations', authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request()
      .input('userId', sql.Int, req.user.id)
      .query(`
        SELECT
          c.id,
          c.taskId,
          c.ownerId,
          c.workerId,
          c.createdAt,

          t.title AS taskTitle,
          t.status AS taskStatus,

          owner.fullName AS ownerFullName,
          owner.email AS ownerEmail,

          worker.fullName AS workerFullName,
          worker.email AS workerEmail,

          lastMsg.message AS lastMessage,
          lastMsg.createdAt AS lastMessageAt
        FROM ChatConversations c
        INNER JOIN Tasks t ON c.taskId = t.id
        INNER JOIN Users owner ON c.ownerId = owner.id
        INNER JOIN Users worker ON c.workerId = worker.id
        OUTER APPLY (
          SELECT TOP 1
            m.message,
            m.createdAt
          FROM ChatMessages m
          WHERE m.conversationId = c.id
          ORDER BY m.createdAt DESC
        ) lastMsg
        WHERE c.ownerId = @userId
           OR c.workerId = @userId
        ORDER BY ISNULL(lastMsg.createdAt, c.createdAt) DESC
      `);

    return res.json({
      success: true,
      conversations: result.recordset.map(formatConversation)
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to get conversations',
      error: error.message
    });
  }
});

/**
 * GET /api/chat/conversations/:id/messages
 *
 * Returns messages for a conversation.
 */
router.get('/conversations/:id/messages', authMiddleware, async (req, res) => {
  try {
    const conversationId = Number(req.params.id);

    if (!Number.isInteger(conversationId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid conversation id'
      });
    }

    const pool = await getPool();

    const accessCheck = await pool.request()
      .input('conversationId', sql.Int, conversationId)
      .input('userId', sql.Int, req.user.id)
      .query(`
        SELECT id
        FROM ChatConversations
        WHERE id = @conversationId
          AND (ownerId = @userId OR workerId = @userId)
      `);

    if (accessCheck.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found or access denied'
      });
    }

    const result = await pool.request()
      .input('conversationId', sql.Int, conversationId)
      .query(`
        SELECT
          m.id,
          m.conversationId,
          m.senderId,
          m.message,
          m.createdAt,

          u.fullName AS senderFullName,
          u.email AS senderEmail,
          u.role AS senderRole
        FROM ChatMessages m
        INNER JOIN Users u ON m.senderId = u.id
        WHERE m.conversationId = @conversationId
        ORDER BY m.createdAt ASC
      `);

    return res.json({
      success: true,
      messages: result.recordset.map(formatMessage)
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to get messages',
      error: error.message
    });
  }
});

/**
 * POST /api/chat/conversations/:id/messages
 *
 * Sends a message in a conversation.
 */
router.post('/conversations/:id/messages', authMiddleware, async (req, res) => {
  try {
    const conversationId = Number(req.params.id);
    const { message } = req.body;

    if (!Number.isInteger(conversationId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid conversation id'
      });
    }

    if (!message || !String(message).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    const pool = await getPool();

    const accessCheck = await pool.request()
      .input('conversationId', sql.Int, conversationId)
      .input('userId', sql.Int, req.user.id)
      .query(`
        SELECT
          id,
          ownerId,
          workerId
        FROM ChatConversations
        WHERE id = @conversationId
          AND (ownerId = @userId OR workerId = @userId)
      `);

    if (accessCheck.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Conversation not found or access denied'
      });
    }

    const result = await pool.request()
      .input('conversationId', sql.Int, conversationId)
      .input('senderId', sql.Int, req.user.id)
      .input('message', sql.NVarChar(sql.MAX), String(message).trim())
      .query(`
        INSERT INTO ChatMessages (
          conversationId,
          senderId,
          message
        )
        OUTPUT INSERTED.*
        VALUES (
          @conversationId,
          @senderId,
          @message
        )
      `);

    const conversation = accessCheck.recordset[0];
    const receiverId = req.user.id === conversation.ownerId
      ? conversation.workerId
      : conversation.ownerId;

    await pool.request()
      .input('userId', sql.Int, receiverId)
      .input('title', sql.NVarChar(200), 'New Message')
      .input('message', sql.NVarChar(sql.MAX), 'You received a new chat message.')
      .query(`
        INSERT INTO Notifications (userId, title, message)
        VALUES (@userId, @title, @message)
      `);

    return res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      chatMessage: formatMessage(result.recordset[0])
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: error.message
    });
  }
});

module.exports = router;