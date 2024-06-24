const express = require("express");
const userController = require("../controllers/userController");
const authVerify = require("../middlewares/authVerify");
const userRoute = express.Router();

userRoute.post("/send-otp", userController.sendOtp);
userRoute.post("/verify", userController.verifyUser);
userRoute.post("/mpin", userController.mpinHandler);
userRoute.post("/expense", authVerify, userController.createExpense);
userRoute.post("/report", authVerify, userController.createReport);
userRoute.get("/list", authVerify, userController.listController);
userRoute.get("/expense/:id", authVerify, userController.getExpense);
userRoute.get("/report/:id", authVerify, userController.getReport);
userRoute.get("/category", authVerify, userController.getCategory);
userRoute.put("/change-mpin", authVerify, userController.changeMpin);
userRoute.post("/report-problem", authVerify, userController.reportProblem);

module.exports = userRoute;
