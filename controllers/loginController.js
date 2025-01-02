const bcrypt = require('bcryptjs');
const db = require('../mySql');

// Show the login page
exports.showLoginPage = (req, res) => {
  res.render('auth/login', { error: null });
};

// Handle login logic for both admin and business owners
exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // Find user by email
    const [rows] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);

    if (rows.length === 0) {
      return res.render('auth/login', { error: 'User not found' });
    }

    const user = rows[0];

    // Compare the entered password with the stored one
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.render('auth/login', { error: 'Incorrect password' });
    }

    // Fetch the company associated with the user (if it's a business owner)
    let company_id = null;
    if (user.role === 'businessOwner') {
      const [companyRows] = await db.execute('SELECT * FROM companies WHERE user_id = ?', [user.id]);
      if (companyRows.length > 0) {
        company_id = companyRows[0].id; // Store company_id if the user is a business owner
      }
    }

    // Store user and company information in session
    req.session.user = { ...user, company_id }; // Add company_id to user session

    // Redirect user based on their role
    if (user.role === 'admin') {
      return res.redirect('/admin/dashboard');
    }

    if (user.role === 'businessOwner') {
      return res.redirect('/business-owner/dashboard');
    }

  } catch (error) {
    console.error('Error during login:', error);
    return res.render('auth/login', { error: 'An error occurred. Please try again.' });
  }
};
