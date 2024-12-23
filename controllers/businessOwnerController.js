const businessOwnerController = {
    viewInventory: (req, res) => {
        // Fetch inventory data from the database
        res.render("businessOwner/inventory", { title: "Inventory" });
    },
    viewSales: (req, res) => {
        // Fetch sales data
        res.render("businessOwner/sales", { title: "Sales" });
    },
    viewExpenses: (req, res) => {
        // Fetch expense data
        res.render("businessOwner/expenses", { title: "Expenses" });
    },
};

module.exports = businessOwnerController;
