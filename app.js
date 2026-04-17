require('dotenv').config();
const express = require("express");
const cors = require("cors");
const app = express();

const PORT = process.env.PORT || 3000;

const profileRoutes = require("./routes/profileRoutes");

app.use(cors({
    origin: "*"
}));

app.use(express.json());

app.use('/api', profileRoutes);

app.get('/',(req, res)=>{
    res.send("Server is live")
});



// app.listen(PORT, ()=>{
//     console.log(`Server is running on port ${PORT}`);
// })

module.exports = app;