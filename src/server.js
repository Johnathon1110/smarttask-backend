const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { getPool } = require('./config/db');

const authRoutes = require('./routes/auth.routes');
const usersRoutes = require('./routes/users.routes');
const tasksRoutes = require('./routes/tasks.routes');
const applicationsRoutes = require('./routes/applications.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const reviewsRoutes = require('./routes/reviews.routes');
const recommendationsRoutes = require('./routes/recommendations.routes');
const chatRoutes = require('./routes/chat.routes');
const adminRoutes = require('./routes/admin.routes');

const app = express();

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

app.get('/api/health', async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query('SELECT 1 AS ok');

    res.json({
      success: true,
      message: 'SmartTask backend is running',
      database: result.recordset[0].ok === 1 ? 'connected' : 'unknown'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Backend is running but database connection failed',
      error: error.message
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/applications', applicationsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/recommendations', recommendationsRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/admin', adminRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`SmartTask backend running on http://localhost:${PORT}`);
});