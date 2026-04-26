require('dotenv').config();
const express = require("express");
const cors = require("cors");
const rateLimit = require('express-rate-limit');
const app = express();

const PORT = process.env.PORT || 3000;

const profileRoutes = require("./routes/profileRoutes");
const authRoutes = require('./routes/authRoutes');

app.set('trust proxy', 1);

// ── Logging middleware ──
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
  });
  next();
});

// ── Rate limiting ──
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  validate: { xForwardedForHeader: false },
  message: { status: 'error', message: 'Too many requests' }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  validate: { xForwardedForHeader: false },
  message: { status: 'error', message: 'Too many requests' }
});

app.use(cors({
    origin: "*"
}));

app.use(express.json());


app.use('/auth', authLimiter, authRoutes);
app.use('/api', apiLimiter, profileRoutes);

app.get('/',(req, res)=>{
    res.send("Server is live")
});



app.listen(PORT, ()=>{
    console.log(`Server is running on port ${PORT}`);
})

module.exports = app;