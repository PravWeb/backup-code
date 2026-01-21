import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res)=>{
    res.send("your welcome to home")
});

app.listen(PORT , ()=>{console.log(`your server is live on http://localhost:${PORT}`)});