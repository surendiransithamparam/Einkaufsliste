const app = require('./src/app');
const startup = require('./src/startup');

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  startup();
});
