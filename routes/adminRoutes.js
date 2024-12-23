const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminControllers");

router.get("/dashboard", adminController.getDashboard);
router.get("/manage-users", adminController.manageUsers);

module.exports = router;
