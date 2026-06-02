const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const rateLimit = require("./middleware/rateLimit");
app.use(rateLimit);

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/test", (req, res) => {
  res.send("test route working");
});

const authRoutes = require("./routes/authRoutes");

app.use("/auth", (req, res, next) => {
  console.log("Auth route reached");
  next();
});
app.use("/auth", authRoutes);

const profileRoutes = require("./routes/profileRoutes");
app.use("/profile", profileRoutes);

const linkRoutes = require("./routes/linkRoutes");
app.use("/links", linkRoutes);

const redirectRoutes = require("./routes/redirectRoutes");
app.use("/", redirectRoutes);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
