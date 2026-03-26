function responseHelpers(req, res, next) {
    res.ok = (data = {}) => res.json(data);
    res.fail = (status, error) => res.status(status).json({ error });
    next();
}

module.exports = responseHelpers;
