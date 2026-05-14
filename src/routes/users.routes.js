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

function formatUser(row) {
  if (!row) return null;

  return {
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
}

function formatPublicUser(row) {
  if (!row) return null;

  return {
    id: row.id,
    fullName: row.fullName,
    role: row.role,
    location: row.location,
    skills: parseJsonArray(row.skills),
    experience: row.experience,
    rating: row.rating
  };
}

/**
 * GET /api/users
 * Admin only: returns all users.
 */
router.get('/', authMiddleware, allowRoles('admin'), async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT id, fullName, email, role, phone, location, skills, experience, rating
      FROM Users
      ORDER BY id DESC
    `);

    return res.json({
      success: true,
      users: result.recordset.map(formatUser)
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
 * GET /api/users/workers
 * Owner/Admin only: returns worker users.
 * Admin receives full worker records.
 * Owner receives public worker profiles only.
 */
router.get('/workers', authMiddleware, allowRoles('owner', 'admin'), async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT id, fullName, email, role, phone, location, skills, experience, rating
      FROM Users
      WHERE role = 'worker'
      ORDER BY rating DESC, id DESC
    `);

    return res.json({
      success: true,
      workers: req.user.role === 'admin'
        ? result.recordset.map(formatUser)
        : result.recordset.map(formatPublicUser)
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to get workers',
      error: error.message
    });
  }
});

/**
 * GET /api/users/:id
 * Returns one user by id.
 * Full profile is available only for self/admin.
 * Owners can view public worker profiles.
 * Workers can view public owner profiles.
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const userId = Number(req.params.id);

    if (!Number.isInteger(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user id'
      });
    }

    const pool = await getPool();

    const result = await pool.request()
      .input('id', sql.Int, userId)
      .query(`
        SELECT id, fullName, email, role, phone, location, skills, experience, rating
        FROM Users
        WHERE id = @id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const targetUser = result.recordset[0];
    const isSelf = req.user.id === userId;
    const isAdmin = req.user.role === 'admin';
    const ownerViewingWorker = req.user.role === 'owner' && targetUser.role === 'worker';
    const workerViewingOwner = req.user.role === 'worker' && targetUser.role === 'owner';

    if (isSelf || isAdmin) {
      return res.json({
        success: true,
        user: formatUser(targetUser)
      });
    }

    if (ownerViewingWorker || workerViewingOwner) {
      return res.json({
        success: true,
        user: formatPublicUser(targetUser)
      });
    }

    return res.status(403).json({
      success: false,
      message: 'You are not allowed to view this user profile'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to get user',
      error: error.message
    });
  }
});

/**
 * PUT /api/users/me
 * Updates current logged-in user profile.
 */
router.put('/me', authMiddleware, async (req, res) => {
  try {
    const {
      fullName,
      phone,
      location,
      skills,
      experience
    } = req.body;

    const skillsJson = Array.isArray(skills) ? JSON.stringify(skills) : null;

    const pool = await getPool();

    const result = await pool.request()
      .input('id', sql.Int, req.user.id)
      .input('fullName', sql.NVarChar(150), fullName !== undefined ? fullName : null)
      .input('phone', sql.NVarChar(30), phone !== undefined ? phone : null)
      .input('location', sql.NVarChar(150), location !== undefined ? location : null)
      .input('skills', sql.NVarChar(sql.MAX), skillsJson)
      .input('experience', sql.NVarChar(150), experience !== undefined ? experience : null)
      .query(`
        UPDATE Users
        SET
          fullName = COALESCE(@fullName, fullName),
          phone = COALESCE(@phone, phone),
          location = COALESCE(@location, location),
          skills = COALESCE(@skills, skills),
          experience = COALESCE(@experience, experience),
          updatedAt = SYSDATETIME()
        OUTPUT INSERTED.id, INSERTED.fullName, INSERTED.email, INSERTED.role,
               INSERTED.phone, INSERTED.location, INSERTED.skills,
               INSERTED.experience, INSERTED.rating
        WHERE id = @id
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    return res.json({
      success: true,
      message: 'Profile updated successfully',
      user: formatUser(result.recordset[0])
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: error.message
    });
  }
});

module.exports = router;