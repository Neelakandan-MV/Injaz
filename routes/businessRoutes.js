const express = require('express');
const router = express.Router();
const businessController = require('../controllers/businessController');
const {isLogged} = require('../middlewares/auth')


router.use((req, res, next) => {
    res.locals.previousRoute = req.session.previousRoute || '/business-owner/dashboard';
    req.session.previousRoute = req.originalUrl; // Update session with the current route
    next();
});

// Business Owner dashboard
router.post('/switch-company', (req, res) => {
    const { companyId } = req.body;
    req.session.companyId = companyId;
    res.redirect('/business-owner/dashboard')
});

router.get('/business-owner/dashboard',isLogged,businessController.viewDashboard);
// router.get('/business-owner/addItems',isLogged,businessController.viewAddItems);
// router.post('/business-owner/addItems',isLogged,businessController.AddItems);
// router.get('/business-owner/editItems',isLogged,businessController.viewEditItems);
// router.post('/business-owner/editItems',isLogged,businessController.editItems);
router.get('/business-owner/viewItems',isLogged,businessController.viewItems);
router.post('/business-owner/addCategory',isLogged,businessController.addCategory);
router.get('/business-owner/sales',isLogged,businessController.viewSales);
router.get('/business-owner/purchases',isLogged,businessController.viewPurchases);
router.get('/business-owner/addSale',isLogged,businessController.viewAddSale);
router.get('/business-owner/addPurchase',isLogged,businessController.viewAddPurchase);
router.post('/business-owner/addTransactions',isLogged,businessController.addTransaction);
// router.post('/business-owner/addCompany',isLogged,businessController.addCompany);
router.get('/business-owner/switchCompany/:id',isLogged,businessController.switchCompany);
router.get('/business-owner/viewParty',isLogged,businessController.viewParty);
router.get('/business-owner/logout',isLogged,businessController.logout);
router.post('/business-owner/addParty',isLogged,businessController.addParty);
router.get('/business-owner/updatePartyStatus',isLogged,businessController.togglePartyStatus);
router.get('/business-owner/dayBook',isLogged,businessController.viewDayBook);
router.get('/business-owner/cashflow',isLogged,businessController.viewCashFlow);
router.get('/business-owner/transactionDetails',isLogged,businessController.transactionDetails);
router.get('/business-owner/transactionDelete',isLogged,businessController.transactionDelete);
router.get('/business-owner/transactionEdit',isLogged,businessController.viewtransactionEdit);
router.post('/business-owner/transactionEdit',isLogged,businessController.transactionEdit);
router.get('/business-owner/removeProduct',isLogged,businessController.removeProductFromTrasaction);
router.get('/business-owner/item-detail',isLogged,businessController.viewItemDetail);
router.get('/business-owner/addExpense',isLogged,businessController.viewAddExpense);
router.post('/business-owner/addExpense',isLogged,businessController.addExpense);
router.get('/business-owner/expenses',isLogged,businessController.viewExpense);
router.post('/business-owner/addExpenseCategory',isLogged,businessController.addExpenseCategory);
router.post('/business-owner/add-contacts',isLogged,businessController.addContacts);
router.post('/business-owner/return',isLogged,businessController.itemReturn);



// router.get('/business-owner/downloadPdf',isLogged,businessController.downloadCashFlow);




module.exports = router;
