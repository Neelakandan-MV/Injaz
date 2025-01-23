const isLogged = (req, res, next) => {
    if (!req.session.user || req.session.user.role !== 'businessOwner') {
        return res.redirect('/login');
    }
    next();
};

const hasRole = (roles) => {
    return (req, res, next) => {
        if (!req.session.user || !roles.includes(req.session.user.role)) {
            return res.redirect('/login');
        }
        next();
    };
};

const isLoggedAdmin = hasRole(['admin', 'superAdmin']);
const isLoggedSuperAdmin = hasRole(['superAdmin']);

module.exports = { isLogged, isLoggedAdmin, isLoggedSuperAdmin };
