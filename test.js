debugger;
var MultiplexServer = require("./dist/multiplex.js").default;

(async ()=>{
  try{
    const server = new MultiplexServer({ listenPort: 9224 });
    await server.listen();
    server.close();
  }catch(e){
    console.log(e)
  }
})();

