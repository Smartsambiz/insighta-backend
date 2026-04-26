const express = require("express");
const router = express.Router();
const crypto = require('crypto');
const axios = require("axios");
const {prisma} = require("../controllers/dbController");
const {v7: uuidv7} = require("uuid");
const {
    generateAccessToken,
    generateRefreshToken,
    verifyAccessToken,
    verifyRefreshToken
} = require("../utils/tokens");
const { ref } = require("process");

// Store state temporarily in memory (short lived, just for OAuh)
const pendingStates = new Set();

// GET /auth/github
// Redirect browser to Github OAuth page
router.get('/github', (req, res)=>{
    const state = crypto.randomBytes(16).toString('hex');
    pendingStates.add(state);

    //Auto-clean state after 10 minutes
    setTimeout(()=> pendingStates.delete(state), 10* 60 * 1000);

    const params = new URLSearchParams({
        client_id: process.env.GITHUB_CLIENT_ID,
        redirect_uri: `${process.env.BACKEND_URL}/auth/github/callback`,
        scope: 'read:user user:email',
        sate,
    });
    res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// GET /auth/github/callback
router.get('/github/callback', async(req, res)=>{
    try{
        const {code, state, code_verifier}= req.query;;

        // Validate state (prevent  CSRF)
        if(!pendingStates.has(state)){
            return res.status(400).json({status: 'error', message: 'Invalid state parameter'});

        }
        pendingStates.delete(state);

        // Exchange code for GitHub access token
        const tokenRes = await axios.post(
            'https://github.com/login/oauth/access_token',
            {
                client_id: process.env.GITHUB_CLIENT_ID,
                client_secret: process.env.GITHUB_CLIENT_SECRET,
                code,
                redirect_uri: `${process.env.BACKEND_URL}/auth/github/callback`,
            },
            {headers: {Accept: 'application/json'}}
        );

        const githubToken = tokenRes.data.access_token;
        if(!githubToken){
            return res.status(502).json({status: 'error', message: 'Github token exchange failed'});

        }

        // Get Github user info
        const [userRes, emailRes] = await Promise.all([
            axios.get('https://api.github.com/user',
            {
                headers: {Authorization: `Bearer ${githubToken}`}
            }
        ),
        axios.get('https://api.github.com/user/emails',
            {
                headers: { Authorization: `Bearer ${githubToken}`}
            }
        )
        ]);

        const githubUser = userRes.data;
        const primaryEmail = emailRes.data.find(e=> e.primary)?.email || null;

        // Create or update user in DB
        let user = await prisma.user.findUnique({
            where: {github_id: String(githubUser.id)}
        });

        if(!user){
            user = await prisma.user.create({
                data: {
                    id: uuidv7(),
                    github_id: String(githubUser.id),
                    username: githubUser.login,
                    email: primaryEmail,
                    avatar_url: githubUser.avatar_url,
                    role: 'analyst',
                    last_login_at: new Date(),
                }
            });
        }else {
            user = await prisma.user.update({
                where: {id: user.id},
                data: {
                    username: githubUser.login,
                    avatar_url: githubUser.avatar_url,
                    last_login_at: new Date(),
                }
            });
        }

        if(!user.is_active){
            return res.status(403).json({status: 'error', message: 'Account is deactivated'});
        }

        // Issue tokens
        const accessToken = generateAccessToken(user);
        const refreshToken = generateRefreshToken(user);

        // Save refresh token to DB
        await prisma.refreshToken.create({
            data: {
                id: uuidv7(),
                token: refreshToken, 
                user_id: user.id,
                expires_at: new Date(Date.now() + 5 * 60 * 1000), // 5min
            }
        });

        // Check if this is a CLI callback (has code_verifier) or browser
        const isCLI = !!code_verifier;

        if(isCLI){
            // Return JSON for CLI to consume
            return res.json({
                status: 'success',
                access_token: accessToken,
                refresh_token: refreshToken,
                user: {id: user.id, username: user.username, role: user.role}
            });
        }

        //For browser - set HTTP-only cookie and redirect to web portal
        res.cookie('refresh_token', refreshToken,{
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 5* 60 * 1000
        });

        // Redirect to frontend with access token in URL fragment
        return res.redirect(
            `${process.env.FRONTEND_URL}/auth/callback?token=${accessToken}`
        );


        
    }catch(err){
        console.error(err);
        return res.status(500).json({status: 'error', message: 'Auth failed'});
    }
});

// ── POST /auth/refresh ──
router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      return res.status(400).json({ status: 'error', message: 'Refresh token required' });
    }

    // Verify JWT signature
    let payload;
    try {
      payload = verifyRefreshToken(refresh_token);
    } catch {
      return res.status(401).json({ status: 'error', message: 'Invalid or expired refresh token' });
    }

    // Check token exists in DB (not already used)
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refresh_token },
      include: { user: true }
    });

    if (!storedToken) {
      return res.status(401).json({ status: 'error', message: 'Token already used or revoked' });
    }

    if (!storedToken.user.is_active) {
      return res.status(403).json({ status: 'error', message: 'Account deactivated' });
    }

    // Delete old token immediately (one-time use)
    await prisma.refreshToken.delete({ where: { token: refresh_token } });

    // Issue new token pair
    const newAccessToken = generateAccessToken(storedToken.user);
    const newRefreshToken = generateRefreshToken(storedToken.user);

    await prisma.refreshToken.create({
      data: {
        id: uuidv7(),
        token: newRefreshToken,
        user_id: storedToken.user.id,
        expires_at: new Date(Date.now() + 5 * 60 * 1000),
      }
    });

    return res.json({
      status: 'success',
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

// ── POST /auth/logout ──
router.post('/logout', async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (refresh_token) {
      await prisma.refreshToken.deleteMany({ where: { token: refresh_token } });
    }
    res.clearCookie('refresh_token');
    return res.json({ status: 'success', message: 'Logged out' });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

module.exports = router;

Step 5: Create middleware/auth.js
jsconst { verifyAccessToken } = require('../utils/tokens');

// Checks the Authorization: Bearer <token> header
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer <token>"

  if (!token) {
    return res.status(401).json({ status: 'error', message: 'Access token required' });
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = payload; // { id, role, username }
    next();
  } catch (err) {
    return res.status(401).json({ status: 'error', message: 'Invalid or expired token' });
  }
}

// Checks that user has admin role
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ status: 'error', message: 'Admin access required' });
  }
  next();
}

// Checks X-API-Version: 1 header
function requireApiVersion(req, res, next) {
  const version = req.headers['x-api-version'];
  if (!version || version !== '1') {
    return res.status(400).json({ status: 'error', message: 'API version header required' });
  }
  next();
}

module.exports = { authenticate, requireAdmin, requireApiVersion };

