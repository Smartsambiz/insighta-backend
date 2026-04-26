const jwt = require("jsonwebtoken");

const ACCESS_EXPIRY = '3m';
const REFRESH_EXPIRY='5m',

function generateAccessToken(user){
    return jwt.sign(
        {id: user.id, role: user.role, username: user.username},
        process.env.JWT_ACCESS_SECRET,
        {expiresIn: ACCESS_EXPIRY}
    );
}

function generateRefreshToken(user){
    return jwt.sign(
        {id: user.id},
        process.env.JWT_REFRESH_SECRET,
        {expiresIn: REFRESH_EXPIRY}
    );
}

function verifyAccessToken(token){
    return jwt.verify(token, process.env.JWT_ACCESS_SECRET)
}

function verifyRefreshToken(token){
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET)
}

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    verifyAccessToken,
    verifyRefreshToken
}