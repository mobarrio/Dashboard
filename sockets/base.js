module.exports = function (io) {
  var debug        = require('debug')('dashboard:server');
  var topparser    = require("../topparser");
  var iostatparser = require("../iostatparser");
  var spawn        = require('child_process').spawn;
  var startTime    = 0;
  var pid_limit    = 10;
  var callback     = null;
  var interval_top = 5;
  var interval_ios = 5;
  var top_data     = "";
  var iostat_data  = "";
  var proc         = null;
  var iostat       = null;
  var process      = {"status":{"top":{"enabled":null},"iostat":{"enabled":null}}};

 // io.sockets.on('connection', function(socket) {
 io.on('connection', function (socket) {
      debug("Nueva conexion entrante.");
      socket.emit('connected', { message: 'Conexion con el server establecida.' });

      // Change interval of Top and IOSTAT
      socket.on('changeInterval', function (data) {
        interval_top = data.interval_top;
        interval_ios = data.interval_ios;
      });

      // Start IOSTAT
      socket.on('start_iostat', function (data) {
        if(iostat && iostat.pid){
          debug("Streaming IOSTAT actuamente activo PID: "+iostat.pid);
          io.sockets.emit('status', { message: "Streaming IOSTAT actuamente activo PID: "+iostat.pid} );
          debug("START IOSTAT: Emite en broadcast un Refr esh IOSTAT: true.");
          io.sockets.emit('refresh', process.status );
          return;
        }

        startTime =  new Date().getTime();
        iostat    = spawn('iostat', ['-x', interval_ios]);
        debug("Cliente sincronizado, arrancando Streaming de IOSTAT PID: "+iostat.pid);
        socket.emit('status', { message: "Arrancando Streaming IOSTAT PID: "+iostat.pid});
        debug("START IOSTAT: Emite en broadcast un Refresh IOSTAT: true.");
        process.status.iostat.enabled = true;
        io.sockets.emit('refresh', process.status );

        iostat.stdout.on('data', function (data) {
          iostat_data+=data.toString();
          processDataIOStat(iostat_data);
        });

        iostat.on('close', function (code) { 
          iostat = null; 
          debug('Deteniendo el streaming de IOSTAT. Codigo de salida: ' + code); 
          debug("STOP IOSTAT: Emite en broadcast un Refresh IOSTAT: false");
          process.status.iostat.enabled = false;
          io.sockets.emit('refresh', process.status );
        });

        var processDataIOStat = function (_data){
          debug("Procesando datos de IOSTAT PID: "+iostat.pid);
          var result=iostatparser.parse(_data);
          if(callback){callback(null,result)}
          debug("Emite Broadcast de IOSTAT a los clientes.");
          io.sockets.emit('msgiostat', result);
          iostat_data="";
        }

        socket.emit('status', { message: "Streaming IOSTAT activado PID: "+iostat.pid});
      });  // End Start IOSTAT

      // Start TOP
      socket.on('start_top', function (data) {
        if(proc && proc.pid){
          debug("Streaming TOP actuamente activo PID: "+proc.pid);
          socket.emit('status', { message: "Streaming TOP actuamente activo PID: "+proc.pid });
          debug("START TOP: Emite en broadcast un Refresh TOP: true.");
          io.sockets.emit('refresh', process.status );
          return;
        }

        startTime =  new Date().getTime();
        proc      = spawn('top', ['-b',"-d", interval_top]);
        debug("Cliente sincronizado, arrancando Streaming de TOP PID: "+proc.pid);
        socket.emit('status', { message: "Arrancando Streaming de TOP PID: "+proc.pid});
        debug("START TOP: Emite en broadcast un Refresh TOP: true.");
        process.status.top.enabled = true;
        io.sockets.emit('refresh', process.status );

        proc.stdout.on('data', function (data) {
          top_data+=data.toString();
          processData(top_data);
        });

        proc.on('close', function (code)   { 
          proc = null; 
          debug('Deteniendo el streaming de TOP. Codigo de salida: ' + code); 
          debug("STOP TOP: Emite en broadcast un Refresh TOP: false");
          process.status.top.enabled = false;
          io.sockets.emit('refresh', process.status );
        });

        var processData = function (_data){
          var start=_data.indexOf("top - ");
          var end=_data.indexOf("top - ",start+1);
          if(end==-1||end==start){return}
          var data=_data.slice(start,end);
          var result=topparser.parse(data,pid_limit);
          if(callback){callback(null,result)}
          debug("Emite Broadcast de TOP a los clientes.");
          io.sockets.emit('msgtop', result);
          top_data="";
        }

        var exec = require('child_process').exec;
        var child = exec('lsb_release -a|grep -i Description|cut -f2');
        child.stdout.on('data', function(data) { io.sockets.emit('msgostype', { os: data.toString() }); });
        child.stderr.on('data', function(data) { io.sockets.emit('msgostype', { os: data.toString() }); });

        socket.emit('status', { message: "Streaming TOP activado PID: "+proc.pid});
      }); // End Start TOP

       // Stop TOP
      socket.on('stop_top', function (data) {
        if(!proc || !proc.pid)
          return socket.emit('status', { message: "Streaming TOP detenido."});

        if(proc && proc.pid){ proc.kill('SIGTERM'); } 
        proc = null; 
        socket.emit('status', { message: "Deteniendo el streaming de TOP." });
        return;
      }); // End Stop TOP

      // Start IOSTAT
      socket.on('stop_iostat', function (data) {
        if(!iostat || !iostat.pid)
          return socket.emit('status', { message: "Streaming IOSTAT detenido."});

        if(iostat && iostat.pid){ iostat.kill('SIGTERM'); }
        iostat = null; 
        socket.emit('status', { message: "Deteniendo el streaming de IOSTAT ." });
        return;
      }); // End Stop IOSTAT

      socket.on('status', function (data) { socket.emit('status', { message: "EHLO OK Connected" }); });

      socket.on('disconnect', function () {
        socket.emit('disconnected');
        if(io.sockets.server.eio.clientsCount === 0){
          if(proc && proc.pid) proc.kill('SIGTERM')
          if(!proc || !proc.pid)
            debug("Proceso TOP finalizado.");
          proc = null; 
          socket.emit('status', { message: "Deteniendo el streaming de TOP" });

          if(iostat && iostat.pid) iostat.kill('SIGTERM')
          if(!iostat || !iostat.pid)
            debug("Proceso IOSTAT finalizado.");
          iostat = null; 
          socket.emit('status', { message: "Deteniendo el streaming de IOSTAT" });
          return;
        }
      });
  });
};
