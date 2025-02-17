const bcrypt = require('bcryptjs');
const db = require('../mySql');


exports.showLoginPage = (req, res) => {
  if(!req.session.user){
  res.render('auth/login', { error: null });
  }else if(req.session.user.role == 'admin' || req.session.user.role == 'superAdmin'){
    res.redirect('admin/dashboard')
  }else{
    res.redirect('business-owner/dashboard')
  }
};

// Handle login logic for both admin and business owners
exports.login = async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const [rows] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);

    if (rows.length === 0) {
      return res.render('auth/login', { error: 'User not found' });
    }

    const user = rows[0];
    

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.render('auth/login', { error: 'Incorrect password' });
    }

    let company_id = null;
    if (user.role === 'businessOwner' || user.role === 'admin' || user.role === 'superAdmin') {
      const [companyRows] = await db.execute(
        `SELECT * FROM companies 
WHERE JSON_CONTAINS(
    (SELECT available_companies FROM users WHERE id = ?), 
    JSON_QUOTE(CAST(id AS CHAR))
);
`,
        [rows[0].id]
    );
    
      if (companyRows.length > 0) {
          company_id = companyRows[0].id;
        }
    }
    
    
    req.session.user = { ...user, company_id }; 
  

    if (user.role === 'admin') {
      res.redirect('/admin/dashboard');
    }

    if (user.role === 'businessOwner') {
      res.redirect('/business-owner/dashboard');
    }

    if(user.role === 'superAdmin'){
      res.redirect('/admin/dashboard')
    }

  } catch (error) {
    console.error('Error during login:', error);
    return res.render('auth/login', { error: 'An error occurred. Please try again.' });
  }
};
