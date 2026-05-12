# SmartTask Connect - Backend

SmartTask Connect is a web-based platform that connects task owners with temporary workers.

This backend provides REST APIs for authentication, users, tasks, applications, skill-based match score, notifications, reviews, chat, and admin management.

## Technologies Used

- Node.js
- Express.js
- Microsoft SQL Server
- JWT Authentication
- bcryptjs
- dotenv
- CORS

## Main Features

- User registration and login
- Role-based access control: Worker, Task Owner, Admin
- Task creation and management
- Worker applications
- Accept or reject applications
- Skill-based match score for tasks and workers
- Worker invitation notifications
- Notifications system
- Chat between accepted task owners and workers
- Reviews and ratings
- Admin dashboard APIs for users and tasks

## Match Score Logic

The system calculates a skill-based match score by comparing the required skills of a task with the skills stored in the worker profile.

Example:

```text
Task required skills: Delivery, Time Management
Worker skills: Delivery, Cleaning

Matched skills: Delivery
Match score: 1 / 2 * 100 = 50%
```
