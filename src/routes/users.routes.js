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
    availability: row.availability,
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
      SELECT id, fullName, email, role, phone, location, skills, experience, availability, rating
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
 * Returns all worker users.
 */
router.get('/workers', authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      SELECT id, fullName, email, role, phone, location, skills, experience, availability, rating
      FROM Users
      WHERE role = 'worker'
      ORDER BY rating DESC, id DESC
    `);

    return res.json({
      success: true,
      workers: result.recordset.map(formatUser)
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
        SELECT id, fullName, email, role, phone, location, skills, experience, availability, rating
        FROM Users
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
      user: formatUser(result.recordset[0])
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
      experience,
      availability
    } = req.body;

    const skillsJson = Array.isArray(skills) ? JSON.stringify(skills) : JSON.stringify([]);

    const pool = await getPool();

    const result = await pool.request()
      .input('id', sql.Int, req.user.id)
      .input('fullName', sql.NVarChar(150), fullName || null)
      .input('phone', sql.NVarChar(30), phone || null)
      .input('location', sql.NVarChar(150), location || null)
      .input('skills', sql.NVarChar(sql.MAX), skillsJson)
      .input('experience', sql.NVarChar(150), experience || null)
      .input('availability', sql.NVarChar(150), availability || null)
      .query(`
        UPDATE Users
        SET
          fullName = COALESCE(@fullName, fullName),
          phone = @phone,
          location = @location,
          skills = @skills,
          experience = @experience,
          availability = @availability,
          updatedAt = SYSDATETIME()
        OUTPUT INSERTED.id, INSERTED.fullName, INSERTED.email, INSERTED.role,
               INSERTED.phone, INSERTED.location, INSERTED.skills,
               INSERTED.experience, INSERTED.availability, INSERTED.rating
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