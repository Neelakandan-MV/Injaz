const mysql = require('../mySql');
const multer = require('multer');
const bcrypt = require('bcryptjs');

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
}).array("image", 5);

const adminController = {

    viewDashboard: async (req, res) => {
        const user = req.session.user;

        try {
            const user = req.session.user;
            
            const [companies] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
            const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
    

            const [total_sale] = await mysql.query("SELECT SUM(total_amount) AS total_sales FROM sales WHERE transaction_type = 'sale';");
            const [total_purchase] = await mysql.query("SELECT SUM(total_amount) AS total_purchase FROM sales WHERE transaction_type = 'purchase';");
            const [total_profit] = await mysql.query("SELECT (SELECT SUM(total_amount) FROM sales WHERE transaction_type = 'sale') - (SELECT SUM(total_amount) FROM sales WHERE transaction_type = 'purchase') AS total_profit;");
            const [outstanding_payments] = await mysql.query("SELECT SUM(balance_due) AS outstanding_payments FROM sales WHERE balance_due > 0;");

            res.render('admin/dashboard.ejs', { title: "Admin Dashboard", total_sale, total_purchase, total_profit, outstanding_payments, currentCompany, companies });
        } catch (error) {
            console.error("Error fetching dashboard data:", error);
            res.render('businessOwner/error.ejs', { error: 'An error occurred while fetching the dashboard data.' });
        }
    },

    viewSales: async (req, res) => {
        const [sales] = await mysql.query(`SELECT invoice_number, customer_name, total_amount, received_amount, balance_due, payment_type, DATE_FORMAT(date, '%Y-%m-%d') AS date
    FROM sales
    WHERE transaction_type = 'sale'
    ORDER BY date DESC;`)

        res.render('admin/sales', { sales });

    },

    viewPurchases: async (req, res) => {

        const [purchases] = await mysql.query(`SELECT invoice_number, customer_name, total_amount, received_amount, balance_due, payment_type, DATE_FORMAT(date, '%Y-%m-%d') AS date
    FROM sales
    WHERE transaction_type = 'purchase'
    ORDER BY date DESC;`)

        res.render('admin/purchases', { purchases });
    },

    viewTransactions: async (req, res) => {

        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;
        const [transactions] = await mysql.query(`SELECT id, invoice_number, customer_name, total_amount, balance_due, payment_type, transaction_type, DATE_FORMAT(date, '%Y-%m-%d') AS date
    FROM sales
    ORDER BY date DESC
    LIMIT ? OFFSET ?`, [parseInt(limit), offset])

        const countResults = await mysql.query(`SELECT COUNT(*) AS total FROM sales;`)
        const totalTransactions = countResults[0].total;
        const totalPages = Math.ceil(totalTransactions / limit);
        res.render('admin/transactions.ejs', {
            transactions,
            totalTransactions,
            totalPages,
            currentPage: parseInt(page),
            limit: parseInt(limit),
        });
    },

    viewUser:async(req,res)=>{
        const [users] = await mysql.query("SELECT * FROM users WHERE role = 'businessOwner';")
        res.render('admin/manageUsers.ejs',{users})
    },

    addUser:async(req,res)=>{
        const {name,email,password} = req.body
        const hashedPassword = await bcrypt.hash(password, 10);
        await mysql.query("INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)",[name,email,hashedPassword,'businessOwner'])
        const [addedUser] = await mysql.query("SELECT * FROM users WHERE email = ?",[email])
        await mysql.query("INSERT INTO companies (user_id,name,created_at) VALUES (?,?,?)",[addedUser[0].id,'Add a Company',new Date()])
        res.redirect('/admin/userManagement')
    },
    userBlock:async(req,res)=>{
        const id = req.params.id
        console.log(id);
        const [user] = await mysql.query("SELECT * FROM users WHERE id = ?",[id])
        if(user[0].isActive){
            await mysql.query("UPDATE users SET isActive = false WHERE id = ?",[id])
        } else {
            await mysql.query("UPDATE users SET isActive = true WHERE id = ?",[id])
        }
        res.json({success:true})
    },
    logout: (req, res) => {
        req.session.destroy();
        res.redirect('/login');
    },

    viewAddItems: async (req, res) => {
        const user = req.session.user;

        const companyId = user.company_id;

        if (!companyId) {
            return res.render("admin/error.ejs", { error: 'No company found for this user.' });
        }

        const [categories] = await mysql.query("SELECT * FROM categories WHERE company_id = ?", [companyId]);

        console.log(categories);
        
        res.render('admin/addItems.ejs', { categories: categories.length > 0 ? categories : [] });
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

            const companyId = user.company_id;

            if (!companyId) {
                return res.render("admin/error.ejs", { error: 'No company found for this user.' });
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
                    return res.render('admin/addItems.ejs', { items, error: 'Product with the same name or code already exists.' });
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
                        companyId,
                        user_id
                    ]
                );

                const [items] = await mysql.query(`
                    SELECT items.*, categories.category AS categoryName 
                    FROM items 
                    LEFT JOIN categories ON items.category_id = categories.id
                    WHERE items.company_id = ?
                `, [companyId]);

                res.render('admin/itemManagement.ejs', { items, user: req.session.user });

            } catch (error) {
                console.error(error);
                return res.render('admin/addItems.ejs', { error: 'An error occurred. Please try again.' });
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

        res.render('admin/itemManagement.ejs', { items, user: req.session.user });
    },

    // Add new category, linking it to the user's company
    addCategory: async (req, res) => {
        const user = req.session.user;
        const companyId = user.company_id;

        if (!companyId) {
            return res.render("businessOwner/error.ejs", { error: 'No company found for this user.' });
        }

        const { category } = req.body;

        try {
            const [categoryExist] = await mysql.query("SELECT * FROM categories WHERE category = ? AND company_id = ?", [category, companyId]);

            if (categoryExist.length > 0) {
                const [categories] = await mysql.query("SELECT * FROM categories WHERE company_id = ?", [companyId]);
                return res.render('admin/addItems.ejs', {
                    categoryError: 'Category Already Exists.',
                    categories
                });
            }

            await mysql.query("INSERT INTO categories (category, user_id, company_id) VALUES (?, ?, ?)", [category, user.id, companyId]);

            const [categories] = await mysql.query("SELECT * FROM categories WHERE company_id = ?", [companyId]);
            return res.render('admin/addItems.ejs', {
                categories,
                success: 'Category added successfully.'
            });
        } catch (error) {
            console.error('Error in addCategory:', error);

            const [categories] = await mysql.query("SELECT * FROM categories WHERE company_id = ?", [companyId]);
            return res.render('admin/addItems.ejs', {
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
        const products = await mysql.query("SELECT * FROM items WHERE user_id = ? AND company_id = ?", [user.id, companyId])
        res.render('admin/addTransactions.ejs', { date: today, products: products[0] });

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

        res.redirect('/admin/transactions');
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

            res.redirect('/admin/dashboard');
        } else {
            // If company already exists, send a response or redirect with a message
            res.redirect('/admin/dashboard?error=Company already exists');
        }
    },

    switchCompany: async (req, res) => {
        const user = req.session.user
        const company_id = req.params.id
        req.session.user.company_id = company_id
        res.redirect('/admin/dashboard');
    },

    viewParty: async (req, res) => {
        const user = req.session.user
        // const parties = await mysql.query("SELECT * FROM parties WHERE user_id = ?",[user.id])
        res.render('businessOwner/partyDisplay.ejs', {});
    },
    viewAddPurchase: async (req, res) => {
        const user = req.session.user
        const today = new Date().toISOString().split('T')[0];
        const products = await mysql.query("SELECT * FROM items WHERE user_id = ?", [user.id])

        res.render('businessOwner/addPurchase.ejs', { date: today, products: products[0] });

    },
    logout: (req, res) => {
        req.session.destroy();
        res.redirect('/login');
    }

};

module.exports = adminController;
