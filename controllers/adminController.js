const mysql = require('../mySql');
const multer = require('multer');
const bcrypt = require('bcryptjs');
require('dotenv').config();

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
        const apiKey = process.env.EXCHANGE_RATE_API_KEY

        try {
            const [companies] = await mysql.query(`SELECT * FROM companies`);
            const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

            const [total_cash_inflow] = await mysql.query(`
                SELECT SUM(amount) AS total_cash_inflow 
                FROM cash_flows 
                WHERE money_type = 'money_in' AND company_id = ?;
            `, [user.company_id]);

            const [total_cash_outflow] = await mysql.query(`
                SELECT SUM(amount) AS total_cash_outflow 
                FROM cash_flows 
                WHERE money_type = 'money_out' AND company_id = ?;
            `, [user.company_id]);

            const [total_expenses] = await mysql.query(`
                SELECT SUM(amount) AS total_expenses 
                FROM expenses 
                WHERE company_id = ?;
            `, [user.company_id]);

            const [total_profit] = await mysql.query(`
                SELECT 
                    (SELECT SUM(amount) FROM cash_flows WHERE money_type = 'money_in' AND company_id = ?) - 
                    (SELECT SUM(amount) FROM cash_flows WHERE money_type = 'money_out' AND company_id = ?) - 
                    (SELECT SUM(amount) FROM expenses WHERE company_id = ?) AS total_profit;
            `, [user.company_id, user.company_id, user.company_id])

            res.render('admin/dashboard.ejs', {
                title: "Admin Dashboard",
                total_cash_inflow,
                total_cash_outflow,
                total_expenses,
                total_profit,
                currentCompany,
                companies,
                apiKey
            });
        } catch (error) {
            console.error("Error fetching dashboard data:", error);
            res.render('admin/error.ejs', { error: 'An error occurred while fetching the dashboard data.' });
        }
    },


    viewSales: async (req, res) => {

        const user = req.session.user
    const [sales] = await mysql.query(`
        SELECT 
            sales.*, 
            parties.PartyName AS customer_name
        FROM 
            sales
        LEFT JOIN 
            parties ON sales.customer_name = parties.id
        WHERE 
            sales.company_id = ? 
            AND sales.transaction_type = 'purchase'
    `, [user.company_id]);
    console.log(sales);

        res.render('admin/sales', { sales });

    },

    viewPurchases: async (req, res) => {
        const user = req.session.user
        const [purchases] = await mysql.query(`
            SELECT 
                sales.*, 
                parties.PartyName AS customer_name
            FROM 
                sales
            LEFT JOIN 
                parties ON sales.customer_name = parties.id
            WHERE 
                sales.company_id = ? 
                AND sales.transaction_type = 'purchase'
        `, [user.company_id]);
        console.log(purchases);

        res.render('admin/purchases', { purchases });
    },

    viewTransactions: async (req, res) => {
        const companyId = req.session.user.company_id
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;
        const [transactions] = await mysql.query(`
            SELECT 
                id, 
                invoice_number, 
                customer_name, 
                total_amount, 
                balance_due, 
                payment_type, 
                transaction_type, 
                DATE_FORMAT(date, '%Y-%m-%d') AS date
            FROM sales
            WHERE company_id = ?
            ORDER BY date DESC
            LIMIT ? OFFSET ?
        `, [companyId, parseInt(limit), offset]);
        

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

    viewUser: async (req, res) => {
        const currentUser = req.session.user;
        const [users] = await mysql.query("SELECT * FROM users WHERE role = 'businessOwner';")
        res.render('admin/manageUsers.ejs', { users, currentUser })
    },

    addUser: async (req, res) => {
        const { name, email, password } = req.body
        const hashedPassword = await bcrypt.hash(password, 10);
        await mysql.query("INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)", [name, email, hashedPassword, 'businessOwner'])
        const [addedUser] = await mysql.query("SELECT * FROM users WHERE email = ?", [email])
        await mysql.query("INSERT INTO companies (user_id,name,created_at) VALUES (?,?,?)", [addedUser[0].id, 'Main', new Date()])
        res.redirect('/admin/userManagement')
    },
    userBlock: async (req, res) => {
        const id = req.params.id
        const [user] = await mysql.query("SELECT * FROM users WHERE id = ?", [id])
        if (user[0].isActive) {
            await mysql.query("UPDATE users SET isActive = false WHERE id = ?", [id])
        } else {
            await mysql.query("UPDATE users SET isActive = true WHERE id = ?", [id])
        }
        res.json({ success: true })
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

        const [categories] = await mysql.query("SELECT * FROM categories");



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
            return res.render("admin/error.ejs", { error: 'No company found for this user.' });
        }

        const [items] = await mysql.query(`
            SELECT items.*, categories.category AS categoryName 
            FROM items 
            LEFT JOIN categories ON items.category_id = categories.id
            WHERE items.company_id = ?
        `, [companyId]);
        console.log(items);
        

        res.render('admin/itemManagement.ejs', { items, user: req.session.user });
    },

    // Add new category, linking it to the user's company
    addCategory: async (req, res) => {
        const user = req.session.user;
        const companyId = user.company_id;

        if (!companyId) {
            return res.render("admin/error.ejs", { error: 'No company found for this user.' });
        }

        const { category } = req.body;

        try {
            const [categoryExist] = await mysql.query("SELECT * FROM categories WHERE category = ? AND company_id = ?", [category, companyId]);

            if (categoryExist.length > 0) {
                const [categories] = await mysql.query("SELECT * FROM categories");
                return res.render('admin/addItems.ejs', {
                    categoryError: 'Category Already Exists.',
                    categories
                });
            }

            await mysql.query("INSERT INTO categories (category, user_id, company_id) VALUES (?, ?, ?)", [category, user.id, companyId]);

            const [categories] = await mysql.query("SELECT * FROM categories");
            return res.render('admin/addItems.ejs', {
                categories,
                success: 'Category added successfully.'
            });
        } catch (error) {
            console.error('Error in addCategory:', error);

            const [categories] = await mysql.query("SELECT * FROM categories");
            return res.render('admin/addItems.ejs', {
                error: 'An error occurred. Please try again.',
                categories
            });
        }
    },

    // View for adding sales
    viewAddTransaction: async (req, res) => {
        const user = req.session.user
        const [companies] = await mysql.query(`SELECT * FROM companies`,);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [parties] = await mysql.query(`SELECT * FROM parties`);
        const today = new Date().toISOString().split('T')[0];
        const companyId = user.company_id;
        const products = await mysql.query("SELECT * FROM items")
        res.render('admin/addTransactions.ejs', { date: today, products: products[0], currentCompany, companies, user, parties });
    },

    addTransaction: async (req, res) => {
        const { partyName, date, invoiceNumber, paymentType, totalAmount, recieved, balanceDue, transactionType } = req.body
        const products = req.body.products
        const user = req.session.user
        const created_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const [party] = await mysql.query(`SELECT * FROM parties WHERE id=?`, [partyName])

        const sales = await mysql.query("INSERT INTO sales (customer_name, user_id, company_id, date, invoice_number, payment_type, total_amount, received_amount, balance_due, created_at, transaction_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
            partyName, user.id, user.company_id, date, invoiceNumber, paymentType, totalAmount, recieved, balanceDue, created_at, transactionType
        ]);

        //saving to cashFLow table
        const money_type = transactionType === 'sale' ? 'money_in' : 'money_out';

        await mysql.query(`INSERT INTO cash_flows (name,date,tnx_type,amount,money_type,tnx_id, company_id) VALUES (?,?,?,?,?,?,?)`,
            [party[0].PartyName, created_at, transactionType, recieved, money_type, sales[0].insertId, user.company_id])

        if (products) {
            await mysql.query("INSERT INTO sale_products (sale_id, item_id, quantity, price, discount, tax_rate, total,company_id, product_name, unit) VALUES ?", [products.map(product => [sales[0].insertId, product.productId, product.quantity, product.pricePerUnit, product.discount, product.tax, product.productTotal, user.company_id, product.item, product.unit])]);
            //managing stock
            if (transactionType === "purchase") {
                for (const product of products) {
                    await mysql.query(`UPDATE items SET stock = stock + ? WHERE id = ?`, [product.quantity, product.productId]);
                    await mysql.query(`INSERT INTO stock_adjustments(item_id,adjustment_type,adjustment_quantity,total_amount,reason,created_at,company_id) VALUES(?,?,?,?,?,?,?)`,
        [product.productId,'add',product.quantity,product.productTotal,'due to purchase',created_at,user.company_id])
                }
                
            } else {
                for (const product of products) {
                    await mysql.query(`UPDATE items SET stock = stock - ? WHERE id = ?`, [product.quantity, product.productId]);
                    await mysql.query(`INSERT INTO stock_adjustments(item_id,adjustment_type,adjustment_quantity,total_amount,reason,created_at,company_id) VALUES(?,?,?,?,?,?,?)`,
                        [product.productId,'reduce',product.quantity,product.productTotal,'due to sale',created_at,user.company_id])
                }
            }

        }

        res.redirect('/admin/dashboard');
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
        const companyId = user.company_id;
        const [companies] = await mysql.query(`SELECT * FROM companies`);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [companyId]);
        const [results] = await mysql.query(`
            SELECT 
                p.id AS party_id,
                p.PartyName AS party_name,
                p.Phone,
                p.Email,
                p.Address,
                p.profile_picture,
                t.id AS transaction_id,
                t.date AS transaction_date,
                t.total_amount AS transaction_amount,
                t.balance_due AS transaction_balance_due
            FROM 
                parties p
            LEFT JOIN 
                sales t ON p.id = t.customer_name
           `);

        // Initialize a map to group transactions by party ID
        const partiesMap = {};

        // Process the results into the desired structure
        results.forEach(row => {
            // If the party doesn't exist in the map, initialize it
            if (!partiesMap[row.party_id]) {
                partiesMap[row.party_id] = {
                    id: row.party_id,
                    name: row.party_name,
                    phone: row.Phone,
                    email: row.Email,
                    address: row.Address,
                    profile_picture: row.profile_picture,
                    transactions: []
                };
            }

            // Add the transaction details to the corresponding party
            if (row.transaction_id) {
                partiesMap[row.party_id].transactions.push({
                    id: row.transaction_id,
                    date: row.transaction_date,
                    amount: row.transaction_amount,
                    balance_due: row.transaction_balance_due
                });
            }
        });

        const parties = Object.values(partiesMap);

        res.render('admin/partyDisplay.ejs', { title: 'parties', currentCompany, companies, user, parties });
    },

    logout: (req, res) => {
        req.session.destroy();
        res.redirect('/login');
    },
    viewReports: async (req, res) => {
        const [total_profit] = await mysql.query("SELECT (SELECT SUM(total_amount) FROM sales WHERE transaction_type = 'sale') - (SELECT SUM(total_amount) FROM sales WHERE transaction_type = 'purchase') AS total_profit;");
        res.render('admin/reports.ejs', { total_profit });
    },
    viewExpense: async (req, res) => {
        const user = req.session.user;
        const company_id = user.company_id;
        const [companies] = await mysql.query(`SELECT * FROM companies`);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [expenses] = await mysql.query(`SELECT * FROM expenses WHERE company_id = ?`, [company_id])

        const [categories] = await mysql.query('SELECT * FROM expense_category');

        const formattedData = categories.map(category => {
            const filteredExpenses = expenses
                .filter(expense => expense.category_id === category.id)
                .map(expense => ({
                    expense_number: expense.expense_number,
                    date: new Date(expense.date),
                    amount: expense.amount,
                }));
            return {
                id: category.id,
                category_name: category.category_name,
                expenses: filteredExpenses,
            };
        });
        res.render('admin/expenseDisplay.ejs', { categories: formattedData })
    },

    viewItemProfitAndLoss: async (req, res) => {
        try {
            const user = req.session.user
            const company_id = user.company_id;
            const [results] = await mysql.query(`
                SELECT 
                    i.id AS item_id,
                    i.item_name,
                    COALESCE(SUM(CASE WHEN s.transaction_type = 'sale' THEN sp.quantity * sp.price ELSE 0 END), 0) AS total_sales,
                    COALESCE(SUM(CASE WHEN s.transaction_type = 'purchase' THEN sp.quantity * sp.price ELSE 0 END), 0) AS total_purchases,
                    CASE 
                        WHEN COALESCE(SUM(CASE WHEN s.transaction_type = 'sale' THEN sp.quantity * sp.price ELSE 0 END), 0) >
                             COALESCE(SUM(CASE WHEN s.transaction_type = 'purchase' THEN sp.quantity * sp.price ELSE 0 END), 0) 
                        THEN COALESCE(SUM(CASE WHEN s.transaction_type = 'sale' THEN sp.quantity * sp.price ELSE 0 END), 0) -
                             COALESCE(SUM(CASE WHEN s.transaction_type = 'purchase' THEN sp.quantity * sp.price ELSE 0 END), 0)
                        ELSE 0 
                    END AS profit,
                    CASE 
                        WHEN COALESCE(SUM(CASE WHEN s.transaction_type = 'purchase' THEN sp.quantity * sp.price ELSE 0 END), 0) >
                             COALESCE(SUM(CASE WHEN s.transaction_type = 'sale' THEN sp.quantity * sp.price ELSE 0 END), 0) 
                        THEN COALESCE(SUM(CASE WHEN s.transaction_type = 'purchase' THEN sp.quantity * sp.price ELSE 0 END), 0) -
                             COALESCE(SUM(CASE WHEN s.transaction_type = 'sale' THEN sp.quantity * sp.price ELSE 0 END), 0)
                        ELSE 0 
                    END AS loss
                FROM 
                    items i
                LEFT JOIN 
                    sale_products sp ON i.id = sp.item_id
                LEFT JOIN 
                    sales s ON sp.sale_id = s.id
                WHERE 
                    i.company_id = ?
                GROUP BY 
                    i.id, i.item_name
                ORDER BY 
                    i.item_name;
            `, [company_id]);
            
            

            res.render('admin/itemProfitAndLoss.ejs', { results })
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Internal server error' });
        }

    },
    viewCashFlow: async (req, res) => {
        const user = req.session.user
        const companyId = user.company_id;
        const [companies] = await mysql.query(`SELECT * FROM companies`);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [cashFlows] = await mysql.query(`SELECT * FROM cash_flows WHERE company_id = ?`, [companyId])

        res.render('admin/cashFlows.ejs', { cashFlows, companies, currentCompany });
    },

    viewDayBook: async (req, res) => {

        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.query(`SELECT * FROM companies`);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);

        const [items] = await mysql.query(`
            SELECT * FROM sales
            WHERE company_id = ?
        `, [companyId]);

        res.render('admin/dayBook.ejs', { title: 'Day Book', currentCompany, companies, user, items });
    },
    viewAddExpense: async (req, res) => {
        const [categories] = await mysql.query('SELECT * FROM expense_category');
        res.render('admin/addExpense.ejs', { categories });
    },
    addExpense: async (req, res) => {
        const user = req.session.user;
        const company_id = user.company_id;
        const { category_id, expense_number, date, amount } = req.body
        await mysql.query(`INSERT INTO expenses (category_id,expense_number,date,amount,company_id) VALUES(?,?,?,?,?)`, [category_id, expense_number, date, amount, company_id])
        res.redirect('/admin/dashboard');

    },

    addExpenseCategory: async (req, res) => {
        const { name } = req.body
        await mysql.query(`INSERT INTO expense_category (category_name) VALUES(?)`, [name])
        res.redirect('/admin/expense')
    },

    viewStockReport: async (req, res) => {
        const user = req.session.user;
        const [items] = await mysql.query(`
            SELECT 
                i.id, 
                i.item_name, 
                i.stock, 
                i.unit, 
                i.sale_price,
                COALESCE(SUM(CASE WHEN s.transaction_type = 'sale' THEN sp.quantity ELSE 0 END), 0) AS quantity_out,  -- Total quantity sold
                COALESCE(SUM(CASE WHEN s.transaction_type = 'purchase' THEN sp.quantity ELSE 0 END), 0) AS quantity_in  -- Total quantity purchased
            FROM items i
            LEFT JOIN sale_products sp ON i.id = sp.item_id
            LEFT JOIN sales s ON sp.sale_id = s.id
            WHERE i.company_id = ?
            GROUP BY i.id
        `, [user.company_id]);
    
            
    res.render('admin/stockReport.ejs',{items})
    },
    viewAdjustStock:async(req,res)=>{
        const {item_id} = req.query
        res.render('admin/adjustStock',{item_id})
        
    },
    viewAdjustStockDetails:async(req,res)=>{
        const {item_id} = req.query
        const [stock_adjustments] = await mysql.query(`SELECT * FROM stock_adjustments WHERE item_id=?`,[item_id])
        const [item] = await mysql.query(`SELECT * FROM items WHERE id=?`,[item_id])
        res.render('admin/adjustStockDetails.ejs',{stock_adjustments,item:item[0]})
    },
    adjustStock:async(req,res)=>{
        const user = req.session.user
        const company_id = user.company_id
        const{adjustmentType,date,quantity,price,details,item_id} = req.body
        await mysql.query(`
            UPDATE items 
            SET stock = stock + ? 
            WHERE id = ?
        `, [adjustmentType == 'add' ? quantity : -quantity, item_id]);
    await mysql.query(`INSERT INTO stock_adjustments(item_id,adjustment_type,adjustment_quantity,total_amount,reason,created_at,company_id) VALUES(?,?,?,?,?,?,?)`,
        [item_id,adjustmentType,quantity,price,details?details:'',date,company_id])
    
        res.redirect('/admin/viewStockReport')  
    },

    viewEditItems:async(req,res)=>{
        const {item_id} = req.query
        const user = req.session.user;
        const companyId = user.company_id;
        const [companies] = await mysql.query(`SELECT * FROM companies WHERE user_id = ?`, [user.id]);
        const [currentCompany] = await mysql.query(`SELECT * FROM companies WHERE id = ?`, [user.company_id]);
        const [categories] = await mysql.query("SELECT * FROM categories WHERE company_id = ?", [companyId]);

        const [item] = await mysql.query(`SELECT * FROM items WHERE id=?`,[item_id])
        
        res.render('admin/itemEdit.ejs',{item:item[0],user,companies,currentCompany,categories})
        
    },

    editItems:async(req,res)=>{
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
                itemCode,
                item_id
            } = req.body;

            const [currentItem] = await mysql.query(`SELECT * FROM items WHERE id=?`,[item_id]);

            
            const image = req.file ? req.file.filename : currentItem[0].image;

            try {
                const user_id = req.session.user.id

                await mysql.query(
                    `UPDATE items 
                     SET 
                        item_name = ?, 
                        item_hsn = ?, 
                        category_id = ?, 
                        unit = ?, 
                        image = ?, 
                        sale_price = ?, 
                        sale_price_tax_included = ?, 
                        discount_value = ?, 
                        discount_type = ?, 
                        wholesale_price = ?, 
                        purchase_price = ?, 
                        purchase_price_tax_included = ?, 
                        tax_rate = ?, 
                        item_code = ?, 
                        company_id = ?, 
                        user_id = ?
                     WHERE id = ?`,
                    [
                        itemName,
                        itemHSN,
                        category,
                        unit,
                        image || null,
                        salePrice || 0,
                        salePriceTaxIncluded || false,
                        discountValue || 0,
                        discountType || null,
                        wholesalePrice || 0,
                        purchasePrice,
                        purchasePriceTaxIncluded || false,
                        taxRate,
                        itemCode,
                        companyId, 
                        user_id,
                        item_id
                    ]
                )

                res.redirect('/admin/viewItems')

            } catch (error) {
                console.error(error);
                return res.render('admin/editItem.ejs', { error: 'An error occurred. Please try again.'});
            }
        });
    },



};

module.exports = adminController;
