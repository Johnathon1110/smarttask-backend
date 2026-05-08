const { sql, getPool } = require('../config/db');

function loadBcrypt() {
  try {
    return require('bcryptjs');
  } catch (error) {
    try {
      return require('bcrypt');
    } catch {
      throw new Error('bcryptjs or bcrypt is required. Install one using: npm install bcryptjs');
    }
  }
}

const bcrypt = loadBcrypt();

const PASSWORD = '123456';

async function hashPassword(password) {
  const saltRounds = 10;
  return bcrypt.hash(password, saltRounds);
}

function toJson(value) {
  return JSON.stringify(value || []);
}

async function getUserByEmail(pool, email) {
  const result = await pool.request()
    .input('email', sql.NVarChar(255), email)
    .query(`
      SELECT *
      FROM Users
      WHERE email = @email
    `);

  return result.recordset[0] || null;
}

async function upsertUser(pool, user) {
  const existing = await getUserByEmail(pool, user.email);

  if (existing) {
    await pool.request()
      .input('id', sql.Int, existing.id)
      .input('fullName', sql.NVarChar(200), user.fullName)
      .input('role', sql.NVarChar(50), user.role)
      .input('phone', sql.NVarChar(50), user.phone || null)
      .input('location', sql.NVarChar(200), user.location || null)
      .input('skills', sql.NVarChar(sql.MAX), toJson(user.skills || []))
      .input('experience', sql.NVarChar(sql.MAX), user.experience || null)
      .input('availability', sql.NVarChar(200), user.availability || null)
      .input('rating', sql.Float, Number(user.rating || 0))
      .query(`
        UPDATE Users
        SET
          fullName = @fullName,
          role = @role,
          phone = @phone,
          location = @location,
          skills = @skills,
          experience = @experience,
          availability = @availability,
          rating = @rating,
          updatedAt = SYSDATETIME()
        WHERE id = @id
      `);

    return {
      ...existing,
      ...user,
      id: existing.id
    };
  }

  const passwordHash = await hashPassword(user.password || PASSWORD);

  const result = await pool.request()
    .input('fullName', sql.NVarChar(200), user.fullName)
    .input('email', sql.NVarChar(255), user.email)
    .input('password', sql.NVarChar(sql.MAX), passwordHash)
    .input('role', sql.NVarChar(50), user.role)
    .input('phone', sql.NVarChar(50), user.phone || null)
    .input('location', sql.NVarChar(200), user.location || null)
    .input('skills', sql.NVarChar(sql.MAX), toJson(user.skills || []))
    .input('experience', sql.NVarChar(sql.MAX), user.experience || null)
    .input('availability', sql.NVarChar(200), user.availability || null)
    .input('rating', sql.Float, Number(user.rating || 0))
    .query(`
      INSERT INTO Users (
        fullName,
        email,
        password,
        role,
        phone,
        location,
        skills,
        experience,
        availability,
        rating
      )
      OUTPUT INSERTED.*
      VALUES (
        @fullName,
        @email,
        @password,
        @role,
        @phone,
        @location,
        @skills,
        @experience,
        @availability,
        @rating
      )
    `);

  return result.recordset[0];
}

async function getTaskByTitle(pool, title, ownerId) {
  const result = await pool.request()
    .input('title', sql.NVarChar(255), title)
    .input('ownerId', sql.Int, ownerId)
    .query(`
      SELECT *
      FROM Tasks
      WHERE title = @title
        AND ownerId = @ownerId
    `);

  return result.recordset[0] || null;
}

async function upsertTask(pool, task) {
  const existing = await getTaskByTitle(pool, task.title, task.ownerId);

  if (existing) {
    await pool.request()
      .input('id', sql.Int, existing.id)
      .input('description', sql.NVarChar(sql.MAX), task.description)
      .input('category', sql.NVarChar(100), task.category)
      .input('type', sql.NVarChar(50), task.type)
      .input('location', sql.NVarChar(200), task.location)
      .input('budget', sql.Decimal(18, 2), Number(task.budget || 0))
      .input('date', sql.NVarChar(50), task.date)
      .input('requiredSkills', sql.NVarChar(sql.MAX), toJson(task.requiredSkills || []))
      .input('status', sql.NVarChar(50), task.status || 'open')
      .query(`
        UPDATE Tasks
        SET
          description = @description,
          category = @category,
          type = @type,
          location = @location,
          budget = @budget,
          date = @date,
          requiredSkills = @requiredSkills,
          status = @status,
          updatedAt = SYSDATETIME()
        WHERE id = @id
      `);

    return {
      ...existing,
      ...task,
      id: existing.id
    };
  }

  const result = await pool.request()
    .input('title', sql.NVarChar(255), task.title)
    .input('description', sql.NVarChar(sql.MAX), task.description)
    .input('category', sql.NVarChar(100), task.category)
    .input('type', sql.NVarChar(50), task.type)
    .input('location', sql.NVarChar(200), task.location)
    .input('budget', sql.Decimal(18, 2), Number(task.budget || 0))
    .input('date', sql.NVarChar(50), task.date)
    .input('ownerId', sql.Int, task.ownerId)
    .input('requiredSkills', sql.NVarChar(sql.MAX), toJson(task.requiredSkills || []))
    .input('status', sql.NVarChar(50), task.status || 'open')
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
        @status
      )
    `);

  return result.recordset[0];
}

async function upsertApplication(pool, taskId, workerId, status = 'accepted') {
  const existing = await pool.request()
    .input('taskId', sql.Int, taskId)
    .input('workerId', sql.Int, workerId)
    .query(`
      SELECT *
      FROM Applications
      WHERE taskId = @taskId
        AND workerId = @workerId
    `);

  if (existing.recordset.length > 0) {
    await pool.request()
      .input('id', sql.Int, existing.recordset[0].id)
      .input('status', sql.NVarChar(50), status)
      .query(`
        UPDATE Applications
        SET status = @status
        WHERE id = @id
      `);

    return {
      ...existing.recordset[0],
      status
    };
  }

  const result = await pool.request()
    .input('taskId', sql.Int, taskId)
    .input('workerId', sql.Int, workerId)
    .input('coverLetter', sql.NVarChar(sql.MAX), 'Seed application: I am available and qualified for this task.')
    .input('status', sql.NVarChar(50), status)
    .query(`
      INSERT INTO Applications (
        taskId,
        workerId,
        coverLetter,
        status
      )
      OUTPUT INSERTED.*
      VALUES (
        @taskId,
        @workerId,
        @coverLetter,
        @status
      )
    `);

  if (status === 'accepted') {
    await pool.request()
      .input('taskId', sql.Int, taskId)
      .query(`
        UPDATE Tasks
        SET status = 'in-progress',
            updatedAt = SYSDATETIME()
        WHERE id = @taskId
      `);
  }

  return result.recordset[0];
}

async function upsertNotification(pool, userId, title, message) {
  const existing = await pool.request()
    .input('userId', sql.Int, userId)
    .input('title', sql.NVarChar(200), title)
    .input('message', sql.NVarChar(sql.MAX), message)
    .query(`
      SELECT TOP 1 *
      FROM Notifications
      WHERE userId = @userId
        AND title = @title
        AND message = @message
      ORDER BY id DESC
    `);

  if (existing.recordset.length > 0) {
    return existing.recordset[0];
  }

  const result = await pool.request()
    .input('userId', sql.Int, userId)
    .input('title', sql.NVarChar(200), title)
    .input('message', sql.NVarChar(sql.MAX), message)
    .query(`
      INSERT INTO Notifications (
        userId,
        title,
        message
      )
      OUTPUT INSERTED.*
      VALUES (
        @userId,
        @title,
        @message
      )
    `);

  return result.recordset[0];
}

async function upsertReview(pool, reviewerId, revieweeId, taskId) {
  const existing = await pool.request()
    .input('reviewerId', sql.Int, reviewerId)
    .input('revieweeId', sql.Int, revieweeId)
    .input('taskId', sql.Int, taskId)
    .query(`
      SELECT *
      FROM Reviews
      WHERE reviewerId = @reviewerId
        AND revieweeId = @revieweeId
        AND taskId = @taskId
    `);

  if (existing.recordset.length > 0) {
    return existing.recordset[0];
  }

  const result = await pool.request()
    .input('reviewerId', sql.Int, reviewerId)
    .input('revieweeId', sql.Int, revieweeId)
    .input('taskId', sql.Int, taskId)
    .input('rating', sql.Int, 5)
    .input('comment', sql.NVarChar(sql.MAX), 'Excellent worker, very professional and reliable.')
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

  await pool.request()
    .input('revieweeId', sql.Int, revieweeId)
    .query(`
      UPDATE Users
      SET rating = (
        SELECT AVG(CAST(rating AS FLOAT))
        FROM Reviews
        WHERE revieweeId = @revieweeId
      ),
      updatedAt = SYSDATETIME()
      WHERE id = @revieweeId
    `);

  return result.recordset[0];
}

async function upsertConversation(pool, taskId, ownerId, workerId) {
  const existing = await pool.request()
    .input('taskId', sql.Int, taskId)
    .input('ownerId', sql.Int, ownerId)
    .input('workerId', sql.Int, workerId)
    .query(`
      SELECT *
      FROM ChatConversations
      WHERE taskId = @taskId
        AND ownerId = @ownerId
        AND workerId = @workerId
    `);

  if (existing.recordset.length > 0) {
    return existing.recordset[0];
  }

  const result = await pool.request()
    .input('taskId', sql.Int, taskId)
    .input('ownerId', sql.Int, ownerId)
    .input('workerId', sql.Int, workerId)
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

  return result.recordset[0];
}

async function addMessageIfMissing(pool, conversationId, senderId, message) {
  const existing = await pool.request()
    .input('conversationId', sql.Int, conversationId)
    .input('senderId', sql.Int, senderId)
    .input('message', sql.NVarChar(sql.MAX), message)
    .query(`
      SELECT TOP 1 *
      FROM ChatMessages
      WHERE conversationId = @conversationId
        AND senderId = @senderId
        AND message = @message
    `);

  if (existing.recordset.length > 0) {
    return existing.recordset[0];
  }

  const result = await pool.request()
    .input('conversationId', sql.Int, conversationId)
    .input('senderId', sql.Int, senderId)
    .input('message', sql.NVarChar(sql.MAX), message)
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

  return result.recordset[0];
}

async function seed() {
  console.log('[Seed] Starting SmartTask seed...');

  const pool = await getPool();

  const admin = await upsertUser(pool, {
    fullName: 'Admin',
    email: 'admin@test.com',
    password: PASSWORD,
    role: 'admin',
    phone: '01099999999',
    location: 'Cairo',
    skills: [],
    rating: 5
  });

  const owner = await upsertUser(pool, {
    fullName: 'Sara Mohamed',
    email: 'owner@test.com',
    password: PASSWORD,
    role: 'owner',
    phone: '01111111111',
    location: 'Giza',
    skills: [],
    rating: 4.8
  });

  const worker = await upsertUser(pool, {
    fullName: 'Ahmed Ali',
    email: 'worker@test.com',
    password: PASSWORD,
    role: 'worker',
    phone: '01000000000',
    location: 'Cairo',
    skills: ['Delivery', 'Cleaning', 'Testing'],
    experience: '1 year',
    availability: 'Evening',
    rating: 5
  });

  const deliveryTask = await upsertTask(pool, {
    title: 'Seed Delivery Helper',
    description: 'Need a worker to help with local delivery tasks.',
    category: 'Delivery',
    type: 'physical',
    location: 'Cairo',
    budget: 250,
    date: '2026-06-01',
    ownerId: owner.id,
    requiredSkills: ['Delivery', 'Time Management'],
    status: 'open'
  });

  const cleaningTask = await upsertTask(pool, {
    title: 'Seed Cleaning Assistant',
    description: 'Need help cleaning and organizing a small office.',
    category: 'Cleaning',
    type: 'physical',
    location: 'Cairo',
    budget: 300,
    date: '2026-06-05',
    ownerId: owner.id,
    requiredSkills: ['Cleaning', 'Organization'],
    status: 'open'
  });

  const acceptedApplication = await upsertApplication(pool, deliveryTask.id, worker.id, 'accepted');

  await upsertNotification(
    pool,
    owner.id,
    'New Application',
    'A worker applied for your seed task.'
  );

  await upsertNotification(
    pool,
    worker.id,
    'Application Accepted',
    'Your application has been accepted.'
  );

  await upsertReview(pool, owner.id, worker.id, deliveryTask.id);

  await upsertNotification(
    pool,
    worker.id,
    'New Review Received',
    'You received a new review from a task owner.'
  );

  const conversation = await upsertConversation(pool, deliveryTask.id, owner.id, worker.id);

  await addMessageIfMissing(
    pool,
    conversation.id,
    owner.id,
    'Hello Ahmed, this is a seed chat message from the owner.'
  );

  await addMessageIfMissing(
    pool,
    conversation.id,
    worker.id,
    'Hello Sara, I received your message and I am available.'
  );

  await upsertNotification(
    pool,
    worker.id,
    'New Message',
    'You received a new chat message.'
  );

  console.log('[Seed] Done.');
  console.log('');
  console.log('Seed accounts:');
  console.log(`Admin : admin@test.com / ${PASSWORD}`);
  console.log(`Owner : owner@test.com / ${PASSWORD}`);
  console.log(`Worker: worker@test.com / ${PASSWORD}`);
  console.log('');
  console.log('Created/updated sample data:');
  console.log(`Admin ID: ${admin.id}`);
  console.log(`Owner ID: ${owner.id}`);
  console.log(`Worker ID: ${worker.id}`);
  console.log(`Delivery Task ID: ${deliveryTask.id}`);
  console.log(`Cleaning Task ID: ${cleaningTask.id}`);
  console.log(`Application ID: ${acceptedApplication.id}`);
  console.log(`Conversation ID: ${conversation.id}`);
}

seed()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('[Seed] Failed:', error);
    process.exit(1);
  });