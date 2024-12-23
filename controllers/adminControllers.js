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
