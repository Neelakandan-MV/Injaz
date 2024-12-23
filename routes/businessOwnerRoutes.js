const express = require("express");
const router = express.Router();
const businessOwnerController = require("../controllers/businessOwnerController");

router.get("/inventory", businessOwnerController.viewInventory);
router.get("/sales", businessOwnerController.viewSales);
router.get("/expenses", businessOwnerController.viewExpenses);

module.exports = router;
