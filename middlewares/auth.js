const isLogged = (req,res,next)=>{
    if (!req.session.user || req.session.user.role !== 'businessOwner') {
        return res.redirect('/login');
    }else{
        next()
    }
}

const isLoggedAdmin = (req,res,next)=>{
    if (!req.session.user) {
        return res.redirect('/login');
    }else{
        next()
    }
}
const isLoggedSuperAdmin = (req,res,next)=>{
    if (!req.session.user || req.session.user.role !== 'superAdmin' ) {
        return res.redirect('/login');
    }else{
        next()
    }
}


module.exports= {isLogged,isLoggedAdmin,isLoggedSuperAdmin }