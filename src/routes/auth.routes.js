const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { sql, getPool } = require('../config/db');
const { authMiddleware } = require('../middleware/auth.middleware');

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

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      email: user.email
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    }
  );
}

/**
 * POST /api/auth/register
 * Creates a new user account.
 */
router.post('/register', async (req, res) => {
  try {
    const {
      fullName,
      email,
      password,
      role,
      phone,
      location,
      skills,
      experience,
      availability
    } = req.body;

    if (!fullName || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: 'fullName, email, password, and role are required'
      });
    }

    if (!['worker', 'owner', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role'
      });
    }

    const pool = await getPool();

    const existingUser = await pool.request()
      .input('email', sql.NVarChar(150), email)
      .query(`
        SELECT id
        FROM Users
        WHERE email = @email
      `);

    if (existingUser.recordset.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Email already exists'
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const skillsJson = Array.isArray(skills) ? JSON.stringify(skills) : JSON.stringify([]);

    const result = await pool.request()
      .input('fullName', sql.NVarChar(150), fullName)
      .input('email', sql.NVarChar(150), email)
      .input('passwordHash', sql.NVarChar(255), passwordHash)
      .input('role', sql.NVarChar(20), role)
      .input('phone', sql.NVarChar(30), phone || null)
      .input('location', sql.NVarChar(150), location || null)
      .input('skills', sql.NVarChar(sql.MAX), skillsJson)
      .input('experience', sql.NVarChar(150), experience || null)
      .input('availability', sql.NVarChar(150), availability || null)
      .query(`
        INSERT INTO Users (
          fullName,
          email,
          passwordHash,
          role,
          phone,
          location,
          skills,
          experience,
          availability
        )
        OUTPUT INSERTED.*
        VALUES (
          @fullName,
          @email,
          @passwordHash,
          @role,
          @phone,
          @location,
          @skills,
          @experience,
          @availability
        )
      `);

    const user = formatUser(result.recordset[0]);
    const token = createToken(user);

    return res.status(201).json({
      success: true,
      message: 'Registration successful',
      token,
      user
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message
    });
  }
});

/**
 * POST /api/auth/login
 * Logs in a user and returns JWT token.
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    const pool = await getPool();

    const result = await pool.request()
      .input('email', sql.NVarChar(150), email)
      .query(`
        SELECT *
        FROM Users
        WHERE email = @email
      `);

    if (result.recordset.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const row = result.recordset[0];

    const isPasswordCorrect = await bcrypt.compare(password, row.passwordHash);

    if (!isPasswordCorrect) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = formatUser(row);
    const token = createToken(user);

    return res.json({
      success: true,
      message: 'Login successful',
      token,
      user
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
});

/**
 * GET /api/auth/me
 * Gets currently logged-in user using JWT token.
 */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.request()
      .input('id', sql.Int, req.user.id)
      .query(`
        SELECT *
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
      message: 'Failed to get current user',
      error: error.message
    });
  }
});

module.exports = router;