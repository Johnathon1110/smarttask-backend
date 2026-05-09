# SmartTask Connect - Backend

SmartTask Connect is a web-based platform that connects task owners with temporary workers.  
The backend provides authentication, task management, applications, recommendations, notifications, reviews, and chat APIs.

## Technologies Used

- Node.js
- Express.js
- Microsoft SQL Server
- JWT Authentication
- bcrypt / bcryptjs
- dotenv

## Project Structure

```text
src/
├── config/
│   └── db.js
├── database/
│   └── schema.sql
├── middleware/
│   └── auth.middleware.js
├── routes/
│   ├── admin.routes.js
│   ├── applications.routes.js
│   ├── auth.routes.js
│   ├── chat.routes.js
│   ├── notifications.routes.js
│   ├── recommendations.routes.js
│   ├── reviews.routes.js
│   ├── tasks.routes.js
│   └── users.routes.js
├── seed/
│   └── seed.js
└── server.js
```
