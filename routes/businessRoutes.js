const express = require('express');
const router = express.Router();
const businessController = require('../controllers/businessController');
const {isLogged,isUserActive} = require('../middlewares/auth')

// Business Owner dashboard
router.post('/switch-company', (req, res) => {
    const { companyId } = req.body;
    req.session.companyId = companyId;
    res.redirect('/business-owner/dashboard')
});

router.get('/business-owner/dashboard',isLogged,businessController.viewDashboard);
router.get('/business-owner/addItems',isLogged,businessController.viewAddItems);
router.post('/business-owner/addItems',isLogged,businessController.AddItems);
router.get('/business-owner/viewItems',isLogged,businessController.viewItems);
router.post('/business-owner/addCategory',isLogged,businessController.addCategory);
router.get('/business-owner/transactions',isLogged,businessController.viewTransactions);
router.get('/business-owner/addTransactions',isLogged,businessController.viewAddTransaction);
router.post('/business-owner/addTransactions',isLogged,businessController.addTransaction);
router.post('/business-owner/addCompany',isLogged,businessController.addCompany);
router.get('/business-owner/switchCompany/:id',isLogged,businessController.switchCompany);
router.get('/business-owner/viewParty',isLogged,businessController.viewParty);
router.get('/business-owner/logout',isLogged,businessController.logout);
router.post('/business-owner/addParty',isLogged,businessController.addParty);
router.get('/business-owner/dayBook',isLogged,businessController.viewDayBook);
router.get('/business-owner/cashflow',isLogged,businessController.viewCashFlow);          


// router.get('/register',businessController.viewRegister)
// router.post('/register',businessController.handleRegister)



module.exports = router;
