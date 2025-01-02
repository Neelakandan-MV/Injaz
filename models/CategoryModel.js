const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema([{
    category: { type: String, required: true },
    userId: {
        type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true
    }
}]);

module.exports = mongoose.model('categories', categorySchema);