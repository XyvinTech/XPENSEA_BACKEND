const moment = require("moment-timezone");
const responseHandler = require("../helpers/responseHandler");
const { sendOtp } = require("../helpers/sendOtp");
const Expense = require("../models/expenseModel");
const Notification = require("../models/notificationModel");
const Report = require("../models/reportModel");
const User = require("../models/userModel");
const { hashPassword, comparePasswords } = require("../utils/bcrypt");
const { generateOTP } = require("../utils/generateOTP");
const { generateToken } = require("../utils/generateToken");
const {
  createExpenseSchema,
  createReportSchema,
  problemSchema,
} = require("../validations");
const Problem = require("../models/problemModel");
const Event = require("../models/eventModel");

/* The `exports.sendOtp` function is responsible for sending an OTP (One Time Password) to a user's
mobile number for verification purposes. Here is a breakdown of what the function is doing: */
exports.sendOtp = async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile) {
      return responseHandler(res, 400, "Mobile is required");
    }
    const user = await User.findOne({ mobile });
    if (!user) {
      return responseHandler(res, 404, "User not found");
    }
    const otp = generateOTP(5);
    const sendOtpFn = await sendOtp(mobile, otp);
    if (sendOtpFn.status == "failure") {
      return responseHandler(res, 400, "OTP sent failed");
    } else {
      user.otp = otp;
      await user.save();
      return responseHandler(res, 200, "OTP sent successfully");
    }
  } catch (error) {
    return responseHandler(res, 500, `Internal Server Error ${error.message}`);
  }
};

/* The `exports.verifyUser` function is responsible for verifying a user based on the OTP (One Time
Password) provided by the user. Here is a breakdown of what the function is doing: */
exports.verifyUser = async (req, res) => {
  try {
    const { otp, mobile } = req.body;
    if (!otp) {
      return responseHandler(res, 400, "OTP is required");
    }
    if (!mobile) {
      return responseHandler(res, 400, "Mobile is required");
    }
    const user = await User.findOne({ mobile });
    if (!user) {
      return responseHandler(res, 404, "User not found");
    }
    if (user.otp !== otp) {
      return responseHandler(res, 400, "Invalid OTP");
    }
    user.otp = null;
    user.isVerified = true;
    user.status = true;
    await user.save();

    return responseHandler(res, 200, "User verified successfully");
  } catch (error) {
    return responseHandler(res, 500, `Internal Server Error ${error.message}`);
  }
};

/* The `exports.mpinHandler` function is responsible for handling the MPIN (Mobile Personal
Identification Number) related operations for a user. Here is a breakdown of what the function is
doing: */
exports.mpinHandler = async (req, res) => {
  try {
    const { mobile, mpin } = req.body;

    if (!mobile) {
      return responseHandler(res, 400, "Mobile number is required");
    }
    if (!mpin) {
      return responseHandler(res, 400, "MPIN is required");
    }

    const user = await User.findOne({ mobile });
    if (!user) {
      return responseHandler(res, 404, "User not found");
    }

    if (user.mpin) {
      const comparePassword = await comparePasswords(mpin, user.mpin);
      if (!comparePassword) {
        return responseHandler(res, 401, "Invalid MPIN");
      }

      const token = generateToken(user._id, user.userType);
      return responseHandler(res, 200, "Login successfull..!", token);
    }

    const hashedPassword = await hashPassword(mpin);
    user.mpin = hashedPassword;
    const updateUser = await user.save();

    if (updateUser) {
      return responseHandler(res, 200, "User MPIN added successfully..!");
    } else {
      return responseHandler(res, 400, "User MPIN update failed...!");
    }
  } catch (error) {
    return responseHandler(res, 500, `Internal Server Error ${error.message}`);
  }
};

/* The `exports.createExpense` function is responsible for creating a new expense record. Here is a
breakdown of what the function is doing: */
exports.createExpense = async (req, res) => {
  try {
    const createExpenseValidator = createExpenseSchema.validate(req.body, {
      abortEarly: true,
    });
    if (createExpenseValidator.error) {
      return responseHandler(
        res,
        400,
        `Invalid input: ${createExpenseValidator.error}`
      );
    }
    req.body.user = req.userId;
    const newExpense = await Expense.create(req.body);
    if (newExpense) {
      return responseHandler(
        res,
        200,
        `Expense created successfully..!`,
        newExpense
      );
    } else {
      return responseHandler(res, 400, `Expense creation failed...!`);
    }
  } catch (error) {
    return responseHandler(res, 500, `Internal Server Error ${error.message}`);
  }
};

/* The `exports.createReport` function is responsible for creating a new report record. Here is a
breakdown of what the function is doing: */
exports.createReport = async (req, res) => {
  try {
    const createReportValidator = createReportSchema.validate(req.body, {
      abortEarly: true,
    });
    if (createReportValidator.error) {
      return responseHandler(
        res,
        400,
        `Invalid input: ${createReportValidator.error.message}`
      );
    }

    const reportCount = await Report.countDocuments();
    const nextReportNumber = reportCount + 1;
    const formattedReportNumber = nextReportNumber.toString().padStart(3, "0");
    req.body.reportId = `Rep#${formattedReportNumber}`;

    const expenseIds = req.body.expenses;
    const expenses = await Expense.find({ _id: { $in: expenseIds } });
    const userId = req.userId;

    // Fetch user and populate tier information
    const user = await User.findOne({ _id: userId }).populate("tier");

    // Object to keep track of total amounts per category
    const categoryTotals = [];

    for (let expense of expenses) {
      if (expense.status === "mapped") {
        return responseHandler(
          res,
          400,
          `Expense with title ${expense.title} is already mapped.`
        );
      }

      // Calculate total amount per category
      const categoryIndex = categoryTotals.findIndex(
        (cat) => cat.title === expense.category
      );
      if (categoryIndex > -1) {
        categoryTotals[categoryIndex].value += expense.amount;
      } else {
        categoryTotals.push({ title: expense.category, value: expense.amount });
      }
    }

    // Check if any category total exceeds the user's tier category max amount
    for (let category of categoryTotals) {
      const tierCategory = user.tier.categories.find(
        (cat) => cat.title === category.title
      );
      if (tierCategory && tierCategory.status === false) {
        return responseHandler(
          res,
          400,
          `Category ${category.title} is disabled.`
        );
      }
      if (tierCategory && category.value > tierCategory.maxAmount) {
        return responseHandler(
          res,
          400,
          `Total amount for category ${category.title} exceeds the maximum allowed.`
        );
      }
    }

    const existingReport = await Report.findOne({
      expenses: { $in: expenseIds },
      status: { $in: ["approved", "reimbursed"] },
    });
    if (existingReport) {
      return responseHandler(
        res,
        400,
        `${existingReport.title} is already included some expenses you mapped.`
      );
    }

    const today = moment().startOf("day");
    const thirtyDaysAgo = moment().subtract(30, "days").startOf("day");

    const existingReports = await Report.find({
      reportDate: { $gte: thirtyDaysAgo.toDate(), $lte: today.toDate() },
      status: { $in: ["approved", "reimbursed"] },
    });

    let existingTotalAmount = 0;
    for (let report of existingReports) {
      const reportExpenses = await Expense.find({
        _id: { $in: report.expenses },
      });
      for (let expense of reportExpenses) {
        existingTotalAmount += expense.amount;
      }
    }

    if (existingTotalAmount > user.tier.totalAmount) {
      return responseHandler(
        res,
        400,
        `The total amount of existing reports within the last 30 days exceeds your tier limit of ${user.tier.totalAmount}.`
      );
    }

    await Expense.updateMany(
      { _id: { $in: expenseIds } },
      { status: "mapped" }
    );

    req.body.user = req.userId;
    const newReport = await Report.create(req.body);
    if (newReport) {
      const data = {
        content: newReport._id,
        user: req.userId,
        status: newReport.status,
      };
      await Notification.create(data);
      return responseHandler(
        res,
        200,
        `Report created successfully..!`,
        newReport
      );
    } else {
      return responseHandler(res, 400, `Report creation failed...!`);
    }
  } catch (error) {
    return responseHandler(res, 500, `Internal Server Error ${error.message}`);
  }
};

/* The above code is a list controller function in a Node.js application that handles requests to fetch
data based on the specified type (reports, expenses, notifications) and page number. Here's a
breakdown of what the code is doing: */
exports.listController = async (req, res) => {
  try {
    const { type, pageNo = 1 } = req.query;
    const skipCount = 10 * (pageNo - 1);
    const filter = {
      user: req.userId,
    };

    if (type === "reports") {
      const totalCount = await Report.countDocuments(filter);
      const fetchReports = await Report.find(filter)
        .populate({
          path: "expenses",
          select: "amount",
        })
        .skip(skipCount)
        .limit(10)
        .lean();
      if (!fetchReports || fetchReports.length === 0) {
        return responseHandler(res, 404, "No Reports found");
      }

      const mappedData = fetchReports.map((item) => {
        const totalAmount = item.expenses.reduce(
          (acc, exp) => acc + exp.amount,
          0
        );
        return {
          _id: item._id,
          title: item.title,
          status: item.status,
          totalAmount,
          expenseCount: item.expenses.length,
          date: moment(item.reportDate).format("MMM DD YYYY"),
        };
      });

      return responseHandler(res, 200, "Reports found", mappedData, totalCount);
    } else if (type === "expenses") {
      const totalCount = await Expense.countDocuments(filter);
      const fetchExpenses = await Expense.find(filter)
        .skip(skipCount)
        .limit(10)
        .lean();
      if (!fetchExpenses || fetchExpenses.length === 0) {
        return responseHandler(res, 404, "No Expenses found");
      }

      const mappedData = fetchExpenses.map((item) => {
        return {
          _id: item._id,
          title: item.title,
          status: item.status,
          amount: item.amount,
          category: item.category,
          date: moment(item.createdAt).format("MMM DD YYYY"),
        };
      });

      return responseHandler(
        res,
        200,
        "Expenses found",
        mappedData,
        totalCount
      );
    } else if (type === "notifications") {
      const totalCount = await Notification.countDocuments(filter);
      const fetchNotifications = await Notification.find(filter)
        .populate({
          path: "content",
          populate: {
            path: "expenses",
            select: "amount",
          },
        })
        .skip(skipCount)
        .limit(10)
        .lean();
      if (!fetchNotifications || fetchNotifications.length === 0) {
        return responseHandler(res, 404, "No Notifications found");
      }

      const mappedData = fetchNotifications.map((item) => {
        const totalAmount = item.content.expenses.reduce(
          (acc, exp) => acc + exp.amount,
          0
        );
        return {
          _id: item._id,
          title: item.content.title,
          status: item.status,
          totalAmount,
          expenseCount: item.content.expenses.length,
          date: moment(item.createdAt).format("MMM DD YYYY"),
        };
      });

      return responseHandler(
        res,
        200,
        "Notifications found",
        mappedData,
        totalCount
      );
    } else if (type === "events") {
      const query = {
        staffs: { $in: [req.userId] },
      }
      const totalCount = await Event.countDocuments(query);
      const fetchEvents = await Event.find(query)
        .skip(skipCount)
        .limit(10)
        .lean();
      if (!fetchEvents || fetchEvents.length === 0) {
        return responseHandler(res, 404, "No Expenses found");
      }

      const mappedData = fetchEvents.map((item) => {
        return {
          _id: item._id,
          eventName: item.eventName,
          startDate: moment(item.startDate).format("MMM DD YYYY"),
          endDate: moment(item.endDate).format("MMM DD YYYY"),
          startTime: moment(item.startTime).format("hh:mm A"),
          endTime: moment(item.endTime).format("hh:mm A"),
          description: item.description,
          location: item.location,
          status: item.status,
        };
      });

      return responseHandler(
        res,
        200,
        "Expenses found",
        mappedData,
        totalCount
      );
    } else {
      return responseHandler(res, 404, "Invalid type..!");
    }
  } catch (error) {
    return responseHandler(res, 500, `Internal Server Error ${error.message}`);
  }
};

/* The `exports.getExpense` function is responsible for fetching a specific expense record based on the
provided expense ID. Here is a breakdown of what the function is doing: */
exports.getExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.userId;
    if (!id) {
      return responseHandler(res, 404, "Expense ID is required");
    }
    const expense = await Expense.findOne({ _id: id, user });

    if (!expense) {
      return responseHandler(res, 404, "Expense not found");
    }

    const mappedData = {
      _id: expense._id,
      title: expense.title,
      status: expense.status,
      amount: expense.amount,
      date: moment(expense.createdAt).format("MMM DD YYYY"),
    };

    return responseHandler(res, 200, "Expense found", mappedData);
  } catch (error) {
    return responseHandler(res, 500, `Internal Server Error ${error.message}`);
  }
};

/* The `exports.getReport` function is responsible for fetching a specific report record based on the
provided report ID. Here is a breakdown of what the function is doing: */
exports.getReport = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.userId;
    if (!id) {
      return responseHandler(res, 404, "Report ID is required");
    }
    const report = await Report.findOne({ _id: id, user }).populate("expenses");

    if (!report) {
      return responseHandler(res, 404, "Report not found");
    }

    const mappedData = {
      _id: report._id,
      reportId: report.reportId,
      title: report.title,
      status: report.status,
      totalAmount: report.expenses.reduce((acc, exp) => acc + exp.amount, 0),
      expenseCount: report.expenses.length,
      expenses: report.expenses.map((expense) => ({
        title: expense.title,
        amount: expense.amount,
        date: moment(expense.date).format("MMM DD YYYY"),
        status: expense.status,
      })),
      date: moment(report.reportDate).format("MMM DD YYYY"),
    };

    return responseHandler(res, 200, "Report found", mappedData);
  } catch (error) {
    return responseHandler(res, 500, `Internal Server Error ${error.message}`);
  }
};

/* The `exports.getCategory` function is responsible for fetching a list of categories. Here is a
breakdown of what the function is doing: */
exports.getCategory = async (req, res) => {
  try {
    const user = await User.findById(req.userId).populate("tier");
    if (!user) {
      return responseHandler(res, 404, "User not found");
    }
    const mappedData = user.tier.categories
      .filter((item) => item.status)
      .map((item) => ({
        title: item.title,
      }));

    return responseHandler(res, 200, "Categories found", mappedData);
  } catch (error) {
    return responseHandler(res, 500, `Internal Server Error ${error.message}`);
  }
};

/* The above code is a JavaScript function that is used to change the MPIN (Mobile Personal
Identification Number) for a user. It takes in the mobile number, new MPIN, and OTP (One Time
Password) as input from the request body. Here is a breakdown of the code: */
exports.changeMpin = async (req, res) => {
  try {
    const { mobile, mpin, otp } = req.body;
    if (!mobile) {
      return responseHandler(res, 400, "Mobile number is required");
    }
    if (!mpin) {
      return responseHandler(res, 400, "MPIN is required");
    }

    const user = await User.findOne({ mobile });
    if (!user) {
      return responseHandler(res, 404, "User not found");
    }

    if (user.otp !== otp) {
      return responseHandler(res, 400, "Invalid OTP");
    }
    user.otp = null;
    const hashedPassword = await hashPassword(mpin);
    user.mpin = hashedPassword;
    await user.save();
    return responseHandler(res, 200, "MPIN changed successfully");
  } catch (error) {
    return responseHandler(res, 500, `Internal Server Error ${error.message}`);
  }
};

/* The above code is a JavaScript function that handles reporting a problem. Here is a breakdown of
what the code is doing: */
exports.reportProblem = async (req, res) => {
  try {
    const problemSchemaValidator = problemSchema.validate(req.body, {
      abortEarly: true,
    });
    if (problemSchemaValidator.error) {
      return responseHandler(
        res,
        400,
        `Invalid input: ${problemSchemaValidator.error}`
      );
    }
    req.body.user = req.userId;
    const report = Problem(req.body);
    if (!report) return responseHandler(res, 400, `Report creation failed`);
    return responseHandler(res, 200, "Reported added successfully");
  } catch (error) {
    return responseHandler(res, 500, `Internal Server Error ${error.message}`);
  }
};
