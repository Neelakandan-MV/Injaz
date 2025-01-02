const User = require('../models/userModel');
const bcrypt = require('bcryptjs');

const adminController = {
    getDashboard: (req, res) => {
        res.render("admin/dashboard", { title: "Admin Dashboard" });
    },
    manageUsers: (req, res) => {
        // Fetch users from the database
        res.render("admin/manageUsers", { title: "Manage Users" });
    },
};



module.exports = adminController;
