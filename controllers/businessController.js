const mysql = require('../mySql'); // Import the MySQL database connection
const multer = require('multer');

// Set up storage for uploaded images
var storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, './uploads');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix);
    }
});

var upload = multer({
    storage: storage,
}).array("images", 5);

const businessOwnerController = {
    // Fetch inventory of the logged-in user's company
    viewInventory: async (req, res) => {
        const user = req.session.user;

        // Fetch company_id using the user_id from companies table
        const [companyData] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
        const companyId = companyData[0] ? companyData[0].id : null;

        if (!companyId) {
            return res.render("businessOwner/error.ejs", { error: 'No company found for this user.' });
        }

        res.render("businessOwner/inventory", { title: "Inventory", companyId });
    },

    // Fetch sales for the logged-in user's company
    viewTransactions: async (req, res) => {
        const user = req.session.user;

        // // Fetch company_id using the user_id from companies table
        // const [companyData] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
        const companyId = user.company_id;
        

        if (!companyId) {
            return res.render("businessOwner/error.ejs", { error: 'No company found for this user.' });
        }

        const [items] = await mysql.query(`
            SELECT * FROM sales
            WHERE company_id = ?
        `, [companyId]);
        

        res.render("businessOwner/transactions.ejs", { title: "Sales", items });
    },

    // Fetch expenses for the logged-in user's company
    viewExpenses: async (req, res) => {
        const user = req.session.user;

        // Fetch company_id using the user_id from companies table
        const [companyData] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
        const companyId = companyData[0] ? companyData[0].id : null;

        if (!companyId) {
            return res.render("businessOwner/error.ejs", { error: 'No company found for this user.' });
        }

        const [expenses] = await mysql.query(`
            SELECT * FROM expenses
            WHERE company_id = ?
        `, [companyId]);

        res.render("businessOwner/expenses", { title: "Expenses", expenses });
    },

    // Fetch dashboard data related to the logged-in user's company
    viewDashboard: async (req, res) => {
        const user = req.session.user;

        try {
            // Fetch company_id using the user_id from companies table
            const [companyData] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
            const companyId = companyData[0] ? companyData[0].id : null;
            const currentCompany = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id])



            if (!companyId) {
                return res.render("businessOwner/error.ejs", { error: 'No company found for this user.' });
            }

            // Fetch transactions related to the company
            // const [transactions] = await mysql.query(`
            //     SELECT * FROM transactions
            //     WHERE company_id = ?
            // `, [companyId]);
            const transactions = ['asdsad', 'aishds', 'saihdidha']

            res.render('businessOwner/dashboard.ejs', { title: "Dashboard", transactions, user, currentCompany: currentCompany[0], companies: companyData });
        } catch (error) {
            console.error("Error fetching dashboard data:", error);
            res.render('businessOwner/error.ejs', { error: 'An error occurred while fetching the dashboard data.' });
        }
    },

    // Fetch categories related to the company
    viewAddItems: async (req, res) => {
        const user = req.session.user;

        // Fetch company_id using the user_id from companies table
        const [companyData] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
        const companyId = companyData[0] ? companyData[0].id : null;

        if (!companyId) {
            return res.render("businessOwner/error.ejs", { error: 'No company found for this user.' });
        }

        const [categories] = await mysql.query("SELECT * FROM categories WHERE company_id = ?", [companyId]);

        res.render('businessOwner/addItems.ejs', { categories: categories.length > 0 ? categories : [] });
    },

    // Add new item, associating it with the company
    AddItems: async (req, res) => {
        upload(req, res, async function (err) {
            if (err instanceof multer.MulterError) {
                return res.status(500).json(err);
            } else if (err) {
                return res.status(500).json(err);
            }

            const user = req.session.user;

            // Fetch company_id using the user_id from companies table
            const [companyData] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
            const companyId = companyData[0] ? companyData[0].id : null;

            if (!companyId) {
                return res.render("businessOwner/error.ejs", { error: 'No company found for this user.' });
            }

            const {
                itemName,
                itemHSN,
                category,
                unit,
                salePrice,
                salePriceTaxIncluded,
                discountValue,
                discountType,
                wholesalePrice,
                purchasePrice,
                purchasePriceTaxIncluded,
                taxRate,
                itemCode
            } = req.body;

            const image = req.files.map(file => file.filename);

            try {
                const [itemExist] = await mysql.query(
                    "SELECT * FROM items WHERE item_name = ? OR item_code = ?",
                    [itemName, itemCode]
                );

                if (itemExist.length > 0) {
                    const [items] = await mysql.query(`
                        SELECT items.*, categories.category AS categoryName 
                        FROM items 
                        LEFT JOIN categories ON items.category_id = categories.id
                        WHERE items.company_id = ?
                    `, [companyId]);
                    return res.render('businessOwner/addItems.ejs', { items, error: 'Product with the same name or code already exists.' });
                }

                const generateItemCode = () => {
                    const prefix = "ITEM";
                    const randomNumber = Math.floor(1000 + Math.random() * 9000);
                    const timestamp = Date.now().toString().slice(-4);
                    return `${prefix}-${randomNumber}-${timestamp}`;
                };

                const newItemCode = itemCode || generateItemCode();
                const user_id = req.session.user.id

                await mysql.query(
                    "INSERT INTO items (item_name, item_hsn, category_id, unit, image, sale_price, sale_price_tax_included, discount_value, discount_type, wholesale_price, purchase_price, purchase_price_tax_included, tax_rate, item_code, company_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    [
                        itemName,
                        itemHSN,
                        category,
                        unit,
                        JSON.stringify(image),
                        salePrice || 0,
                        salePriceTaxIncluded || false,
                        discountValue || 0,
                        discountType || null,
                        wholesalePrice || 0,
                        purchasePrice,
                        purchasePriceTaxIncluded || false,
                        taxRate,
                        newItemCode,
                        companyId, // Associating item with company
                        user_id
                    ]   
                );

                const [items] = await mysql.query(`
                    SELECT items.*, categories.category AS categoryName 
                    FROM items 
                    LEFT JOIN categories ON items.category_id = categories.id
                    WHERE items.company_id = ?
                `, [companyId]);

                res.render('businessOwner/itemDisplay.ejs', { items, user: req.session.user });

            } catch (error) {
                console.error(error);
                return res.render('businessOwner/addItems.ejs', { error: 'An error occurred. Please try again.' });
            }
        });
    },

    // Fetch items related to the company
    viewItems: async (req, res) => {
        const user = req.session.user;

        const companyId = user.company_id;

        if (!companyId) {
            return res.render("businessOwner/error.ejs", { error: 'No company found for this user.' });
        }

        const [items] = await mysql.query(`
            SELECT items.*, categories.category AS categoryName 
            FROM items 
            LEFT JOIN categories ON items.category_id = categories.id
            WHERE items.company_id = ?
        `, [companyId]);

        res.render('businessOwner/itemDisplay.ejs', { items, user: req.session.user });
    },

    // Add new category, linking it to the user's company
    addCategory: async (req, res) => {
        const user = req.session.user;

        // Fetch company_id using the user_id from companies table
        const [companyData] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
        const companyId = companyData[0] ? companyData[0].id : null;

        if (!companyId) {
            return res.render("businessOwner/error.ejs", { error: 'No company found for this user.' });
        }

        const { category } = req.body;

        try {
            const [categoryExist] = await mysql.query("SELECT * FROM categories WHERE category = ? AND company_id = ?", [category, companyId]);

            if (categoryExist.length > 0) {
                const [categories] = await mysql.query("SELECT * FROM categories WHERE company_id = ?", [companyId]);
                return res.render('businessOwner/addItems.ejs', {
                    categoryError: 'Category Already Exists.',
                    categories
                });
            }

            await mysql.query("INSERT INTO categories (category, user_id, company_id) VALUES (?, ?, ?)", [category, user.id, companyId]);

            const [categories] = await mysql.query("SELECT * FROM categories WHERE company_id = ?", [companyId]);
            return res.render('businessOwner/addItems.ejs', {
                categories,
                success: 'Category added successfully.'
            });
        } catch (error) {
            console.error('Error in addCategory:', error);

            const [categories] = await mysql.query("SELECT * FROM categories WHERE company_id = ?", [companyId]);
            return res.render('businessOwner/addItems.ejs', {
                error: 'An error occurred. Please try again.',
                categories
            });
        }
    },

    // View for adding sales
    viewAddTransaction: async (req, res) => {
        const user = req.session.user
        const today = new Date().toISOString().split('T')[0];
        const companyId = user.company_id;
        const products = await mysql.query("SELECT * FROM items WHERE user_id = ? AND company_id = ?",[user.id,companyId])
        
        res.render('businessOwner/addTransactions.ejs', { date: today, products:products[0]});
        
    },

    addTransaction: async (req, res) => {
        const { partyName, date, invoiceNumber, paymentType, totalAmount, recieved, balanceDue, transactionType } = req.body
        const products = req.body.products
        const user = req.session.user
        const created_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const sales = await mysql.query("INSERT INTO sales (customer_name, user_id, company_id, date, invoice_number, payment_type, total_amount, received_amount, balance_due, created_at, transaction_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
            partyName, user.id, user.company_id, date, invoiceNumber, paymentType, totalAmount, recieved, balanceDue, created_at, transactionType
        ]);
        
        await mysql.query("INSERT INTO sale_products (sale_id, item_id, quantity, price, discount, tax_rate, total,company_id) VALUES ?", [products.map(product => [sales[0].insertId, product.productId, product.quantity, product.pricePerUnit, product.discount, product.tax, product.productTotal, user.company_id])]);
        
        res.redirect('/business-owner/transactions');
    },

    addCompany: async (req, res) => {
        const { name } = req.body;
        const user_id = req.session.user.id;

        // Check if the company already exists
        const companyExist = await mysql.query(`SELECT * FROM companies WHERE name = ?`, [name]);

        if (companyExist[0].length === 0) {
            // Insert the new company into the database
            await mysql.query(`INSERT INTO companies (user_id, name, created_at) VALUES (?, ?, ?)`,
                [user_id, name, new Date()]);

            console.log('new company created');

            res.redirect('/business-owner/dashboard');
        } else {
            // If company already exists, send a response or redirect with a message
            res.redirect('/business-owner/dashboard?error=Company already exists');
        }
    },

    switchCompany: async (req, res) => {
        const user = req.session.user
        const company_id = req.params.id
        req.session.user.company_id = company_id
        res.redirect('/business-owner/dashboard');
    },

    viewParty: async (req, res) => {
        const user = req.session.user
        // const parties = await mysql.query("SELECT * FROM parties WHERE user_id = ?",[user.id])
        res.render('businessOwner/partyDisplay.ejs', {});
    },
    viewAddPurchase: async (req, res) => {
        const user = req.session.user
        const today = new Date().toISOString().split('T')[0];
        const products = await mysql.query("SELECT * FROM items WHERE user_id = ?",[user.id])
        
        res.render('businessOwner/addPurchase.ejs', { date: today, products:products[0]});
        
    }

};

module.exports = businessOwnerController;
