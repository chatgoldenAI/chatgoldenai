// index.js - GoldenChat Main Server File
// Powered by GoldenSpaceAI - GPT-5 Integration Platform

require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const mongoose = require('mongoose');

// Import routes and middleware
const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const userRoutes = require('./routes/users');
const adminRoutes = require('./routes/admin');

// Import services
const GoldenAIService = require('./services/goldenAIService');
const DatabaseService = require('./services/databaseService');
const SocketService = require('./services/socketService');

// Import middleware
const authMiddleware = require('./middleware/auth');
const loggingMiddleware = require('./middleware/logging');

class GoldenChatServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server, {
      cors: {
        origin: process.env.ALLOWED_ORIGINS || "http://localhost:3000",
        methods: ["GET", "POST"]
      }
    });
    
    this.port = process.env.PORT || 5000;
    this.isProduction = process.env.NODE_ENV === 'production';
    
    // Initialize services
    this.goldenAIService = new GoldenAIService();
    this.databaseService = new DatabaseService();
    this.socketService = new SocketService(this.io);
    
    this.initializeMiddlewares();
    this.initializeRoutes();
    this.initializeSocketHandlers();
    this.initializeErrorHandling();
  }

  initializeMiddlewares() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP, please try again later.'
    });
    this.app.use(limiter);

    // CORS
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
      credentials: true
    }));

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Compression
    this.app.use(compression());

    // Custom logging
    this.app.use(loggingMiddleware);

    // Static files (if needed)
    this.app.use('/uploads', express.static('uploads'));
  }

  initializeRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.status(200).json({
        status: 'healthy',
        service: 'GoldenChat API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
      });
    });

    // API routes
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/chat', authMiddleware.authenticate, chatRoutes);
    this.app.use('/api/users', authMiddleware.authenticate, userRoutes);
    this.app.use('/api/admin', authMiddleware.authenticate, authMiddleware.requireAdmin, adminRoutes);

    // Welcome route
    this.app.get('/', (req, res) => {
      res.json({
        message: 'Welcome to GoldenChat API - Powered by GoldenSpaceAI',
        description: 'Advanced GPT-5 Chat Platform',
        version: '1.0.0',
        endpoints: {
          auth: '/api/auth',
          chat: '/api/chat',
          users: '/api/users',
          admin: '/api/admin'
        },
        documentation: '/api/docs'
      });
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Endpoint not found',
        message: `The route ${req.originalUrl} does not exist on this server.`
      });
    });
  }

  initializeSocketHandlers() {
    this.io.use(this.socketService.authenticateSocket);
    
    this.io.on('connection', (socket) => {
      console.log(`User ${socket.userId} connected via WebSocket`);
      
      // Join user to their personal room
      socket.join(`user:${socket.userId}`);
      
      // Chat message handling
      socket.on('send_message', async (data) => {
        await this.socketService.handleChatMessage(socket, data);
      });

      // Typing indicators
      socket.on('typing_start', (data) => {
        socket.to(data.chatId).emit('user_typing', { userId: socket.userId });
      });

      socket.on('typing_stop', (data) => {
        socket.to(data.chatId).emit('user_stop_typing', { userId: socket.userId });
      });

      // Disconnect handling
      socket.on('disconnect', (reason) => {
        console.log(`User ${socket.userId} disconnected: ${reason}`);
        this.socketService.handleDisconnect(socket);
      });

      // Error handling
      socket.on('error', (error) => {
        console.error('Socket error:', error);
        socket.emit('error', { message: 'An error occurred' });
      });
    });
  }

  initializeErrorHandling() {
    // Global error handler
    this.app.use((error, req, res, next) => {
      console.error('Global error handler:', error);

      const statusCode = error.statusCode || 500;
      const message = error.message || 'Internal Server Error';

      res.status(statusCode).json({
        error: {
          message: message,
          code: error.code || 'INTERNAL_ERROR',
          ...(this.isProduction ? {} : { stack: error.stack })
        }
      });
    });

    // Process event handlers
    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      // Close server & exit process
      process.exit(1);
    });

    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      process.exit(1);
    });
  }

  async initializeDatabase() {
    try {
      await this.databaseService.connect();
      console.log('✅ Database connected successfully');
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      process.exit(1);
    }
  }

  async initializeAIService() {
    try {
      await this.goldenAIService.initialize();
      console.log('✅ GoldenSpaceAI service initialized successfully');
    } catch (error) {
      console.error('❌ GoldenSpaceAI service initialization failed:', error);
      process.exit(1);
    }
  }

  async start() {
    try {
      // Initialize services
      await this.initializeDatabase();
      await this.initializeAIService();

      // Start server
      this.server.listen(this.port, () => {
        console.log(`
🚀 GoldenChat Server Started Successfully!
📍 Port: ${this.port}
🌍 Environment: ${process.env.NODE_ENV || 'development'}
⏰ Time: ${new Date().toISOString()}
📡 WebSocket: Enabled
🤖 AI: GPT-5 + GoldenSpaceAI Integration
        `);
      });

    } catch (error) {
      console.error('❌ Failed to start GoldenChat server:', error);
      process.exit(1);
    }
  }

  async gracefulShutdown() {
    console.log('\n🛑 Received shutdown signal, initiating graceful shutdown...');
    
    try {
      // Close HTTP server
      this.server.close(() => {
        console.log('✅ HTTP server closed');
      });

      // Close database connection
      await this.databaseService.disconnect();
      console.log('✅ Database connections closed');

      // Close AI service connections
      await this.goldenAIService.shutdown();
      console.log('✅ AI services shut down');

      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  }
}

// Create and start server instance
const goldenChatServer = new GoldenChatServer();

// Handle graceful shutdown
process.on('SIGTERM', () => goldenChatServer.gracefulShutdown());
process.on('SIGINT', () => goldenChatServer.gracefulShutdown());

// Start the server
goldenChatServer.start();

module.exports = goldenChatServer;
