IF DB_ID('SmartTaskDB') IS NULL
BEGIN
    CREATE DATABASE SmartTaskDB;
END
GO

USE SmartTaskDB;
GO

IF OBJECT_ID('dbo.Users', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Users (
        id INT IDENTITY(1,1) PRIMARY KEY,
        fullName NVARCHAR(200) NOT NULL,
        email NVARCHAR(255) NOT NULL UNIQUE,
        passwordHash NVARCHAR(MAX) NOT NULL,
        role NVARCHAR(50) NOT NULL CHECK (role IN ('admin', 'owner', 'worker')),
        phone NVARCHAR(50) NULL,
        location NVARCHAR(200) NULL,
        skills NVARCHAR(MAX) NULL,
        experience NVARCHAR(MAX) NULL,
        availability NVARCHAR(200) NULL,
        rating FLOAT NOT NULL DEFAULT 0,
        createdAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        updatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME()
    );
END
GO

IF OBJECT_ID('dbo.Tasks', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Tasks (
        id INT IDENTITY(1,1) PRIMARY KEY,
        title NVARCHAR(255) NOT NULL,
        description NVARCHAR(MAX) NOT NULL,
        category NVARCHAR(100) NOT NULL,
        type NVARCHAR(50) NOT NULL CHECK (type IN ('physical', 'remote')),
        location NVARCHAR(200) NULL,
        budget DECIMAL(18,2) NOT NULL DEFAULT 0,
        date NVARCHAR(50) NULL,
        ownerId INT NOT NULL,
        requiredSkills NVARCHAR(MAX) NULL,
        status NVARCHAR(50) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in-progress', 'completed', 'cancelled')),
        createdAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        updatedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

        CONSTRAINT FK_Tasks_Users_Owner
            FOREIGN KEY (ownerId) REFERENCES dbo.Users(id)
    );
END
GO

IF OBJECT_ID('dbo.Applications', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Applications (
        id INT IDENTITY(1,1) PRIMARY KEY,
        taskId INT NOT NULL,
        workerId INT NOT NULL,
        coverLetter NVARCHAR(MAX) NULL,
        status NVARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
        appliedAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

        CONSTRAINT FK_Applications_Tasks
            FOREIGN KEY (taskId) REFERENCES dbo.Tasks(id),

        CONSTRAINT FK_Applications_Users_Worker
            FOREIGN KEY (workerId) REFERENCES dbo.Users(id),

        CONSTRAINT UQ_Applications_Task_Worker
            UNIQUE (taskId, workerId)
    );
END
GO

IF OBJECT_ID('dbo.TaskInvitations', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.TaskInvitations (
        id INT IDENTITY(1,1) PRIMARY KEY,
        taskId INT NOT NULL,
        ownerId INT NOT NULL,
        workerId INT NOT NULL,
        status NVARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
        createdAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        respondedAt DATETIME2 NULL,

        CONSTRAINT FK_TaskInvitations_Tasks
            FOREIGN KEY (taskId) REFERENCES dbo.Tasks(id),

        CONSTRAINT FK_TaskInvitations_Users_Owner
            FOREIGN KEY (ownerId) REFERENCES dbo.Users(id),

        CONSTRAINT FK_TaskInvitations_Users_Worker
            FOREIGN KEY (workerId) REFERENCES dbo.Users(id),

        CONSTRAINT UQ_TaskInvitations_Task_Worker
            UNIQUE (taskId, workerId)
    );
END
GO

IF OBJECT_ID('dbo.Notifications', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Notifications (
        id INT IDENTITY(1,1) PRIMARY KEY,
        userId INT NOT NULL,
        title NVARCHAR(200) NOT NULL,
        message NVARCHAR(MAX) NOT NULL,
        isRead BIT NOT NULL DEFAULT 0,
        createdAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

        CONSTRAINT FK_Notifications_Users
            FOREIGN KEY (userId) REFERENCES dbo.Users(id)
    );
END
GO

IF OBJECT_ID('dbo.Reviews', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.Reviews (
        id INT IDENTITY(1,1) PRIMARY KEY,
        reviewerId INT NOT NULL,
        revieweeId INT NOT NULL,
        taskId INT NOT NULL,
        rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment NVARCHAR(MAX) NULL,
        createdAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

        CONSTRAINT FK_Reviews_Users_Reviewer
            FOREIGN KEY (reviewerId) REFERENCES dbo.Users(id),

        CONSTRAINT FK_Reviews_Users_Reviewee
            FOREIGN KEY (revieweeId) REFERENCES dbo.Users(id),

        CONSTRAINT FK_Reviews_Tasks
            FOREIGN KEY (taskId) REFERENCES dbo.Tasks(id),

        CONSTRAINT UQ_Reviews_Reviewer_Reviewee_Task
            UNIQUE (reviewerId, revieweeId, taskId)
    );
END
GO

IF OBJECT_ID('dbo.ChatConversations', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ChatConversations (
        id INT IDENTITY(1,1) PRIMARY KEY,
        taskId INT NOT NULL,
        ownerId INT NOT NULL,
        workerId INT NOT NULL,
        createdAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

        CONSTRAINT FK_ChatConversations_Tasks
            FOREIGN KEY (taskId) REFERENCES dbo.Tasks(id),

        CONSTRAINT FK_ChatConversations_Users_Owner
            FOREIGN KEY (ownerId) REFERENCES dbo.Users(id),

        CONSTRAINT FK_ChatConversations_Users_Worker
            FOREIGN KEY (workerId) REFERENCES dbo.Users(id),

        CONSTRAINT UQ_ChatConversations_Task_Owner_Worker
            UNIQUE (taskId, ownerId, workerId)
    );
END
GO

IF OBJECT_ID('dbo.ChatMessages', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.ChatMessages (
        id INT IDENTITY(1,1) PRIMARY KEY,
        conversationId INT NOT NULL,
        senderId INT NOT NULL,
        message NVARCHAR(MAX) NOT NULL,
        createdAt DATETIME2 NOT NULL DEFAULT SYSDATETIME(),

        CONSTRAINT FK_ChatMessages_ChatConversations
            FOREIGN KEY (conversationId) REFERENCES dbo.ChatConversations(id),

        CONSTRAINT FK_ChatMessages_Users_Sender
            FOREIGN KEY (senderId) REFERENCES dbo.Users(id)
    );
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_Tasks_OwnerId'
      AND object_id = OBJECT_ID('dbo.Tasks')
)
BEGIN
    CREATE INDEX IX_Tasks_OwnerId ON dbo.Tasks(ownerId);
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_Applications_TaskId'
      AND object_id = OBJECT_ID('dbo.Applications')
)
BEGIN
    CREATE INDEX IX_Applications_TaskId ON dbo.Applications(taskId);
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_Applications_WorkerId'
      AND object_id = OBJECT_ID('dbo.Applications')
)
BEGIN
    CREATE INDEX IX_Applications_WorkerId ON dbo.Applications(workerId);
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_Notifications_UserId'
      AND object_id = OBJECT_ID('dbo.Notifications')
)
BEGIN
    CREATE INDEX IX_Notifications_UserId ON dbo.Notifications(userId);
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_ChatMessages_ConversationId'
      AND object_id = OBJECT_ID('dbo.ChatMessages')
)
BEGIN
    CREATE INDEX IX_ChatMessages_ConversationId ON dbo.ChatMessages(conversationId);
END
GO