'use strict';
const to = require('await-to-js').default;
var debug = require('debug')('loopback:log:models:Resident');

module.exports = function(Resident) {
  const Model = Resident;

  /* Function that return the last 4 wasteCollections for user logged-in */
  Resident.__get__lastFourWasteCollection = function(id, cb){
      return Resident.find({
          where: {
              id: id
          },
          fields: ['id', 'name', 'bucketId'],
          include:{
              relation: 'bucket',
              scope: {
                  fields: ['id', 'wasteCollections'],
                  include: {
                      relation: 'wasteCollections',
                      scope: {
                          fields: ['id', 'weight', 'created', 'scaleId'],
                          limit: '4',
                          include: {
                              relation: 'scale',
                              scope: {
                                  fields: ['recyclerId'],
                                  include: {
                                      relation: 'recycler',
                                      scope: {
                                          fields: ['name']
                                      }
                                  }
                              }
                          }
                      }
                  }
              }
          }
      })
  };

  Resident.remoteMethod('__get__lastFourWasteCollection', {
      accepts: {arg: 'id', type: 'string'},
      returns: {arg: 'data', type: 'object'},
      http: {verb: 'GET', path: '/:id/lastFourWasteCollection'}
  });

  /*Function that return the date of collection of his Community*/
  Resident.__get__dateCollection = function(id, cb){
      Resident.find({
          fields: ['communityId'],
          where: {
              id: id
          },
          include: {
              relation: 'community',
              scope: {
                  fields: ['name', 'dateCollection']
              }
          }
      })
      .then(function(res){
          if(!res){
              console.log('No hay resultados')
              cb(null, false)
          }
          else {
              let response = res.map(item => {return item.toJSON()})
              let date = {
                  "community": response[0]['community']['name'],
                  "dateCollection": response[0]['community']['dateCollection']
              }
              cb(null, date)
          }
      })
  };

  Resident.remoteMethod('__get__dateCollection', {
      accepts: {arg: 'id', type: 'string'},
      returns: {arg: 'data', type: 'object'},
      http: {verb: 'GET', path: '/:id/dateCollection'}
  });


  /* Custom delete */
  Resident.customDelete = function(id, cb){
    Resident.findById(id, function(err, instance){
      if(err){
        cb(err);
        return null;
      }
      const resident = instance;
      //Check active of instance
      if(resident.active == 'true'){
        resident.updateAttributes({'active': false}, function(err, data){
          if(err){
            cb(err);
            return null;
          }
          cb(data);
        })
      }
      else{
        let error = new Error()
        error.statusCode = 409
        error.code = 'USER_NOT_ACTIVE'
        error.name = 'Resident ' + resident.name + ' was already deleted'
        error.message = 'Resident ' + resident.name + ' is not active'
        cb(error);
      }
    })
  }

  Resident.remoteMethod('customDelete', {
    accepts: {arg: 'id', type: 'string'},
    return: {arg: 'data', type: 'object'},
    http: {verb: 'DELETE', path: '/:id/customDelete'}
  });


  /* Resolve assignment for Resident */
  Resident.beforeRemote('prototype.__updateById__assignments', async (ctx, modelInstance, next)=>{
    let bucket, err, updatedBucket, residentBucket, assignment, updatedAssignment;
    //Validate that resident doesn't have bucket
    [err, residentBucket] = await to(Model.app.models['Bucket'].findOne({ where: { residentId: ctx.instance.id }}))
    if(residentBucket) {
      let error = new Error()
      error.statusCode = 409
      error.code = 'ALREADY_HAVE_BUCKET'
      error.name = 'Resident already have one bucket associated'
      error.message = 'Resident already have one bucket associated.'
      return next(error);
    }

    //Find one bucket non active 
    [err, bucket] = await to(Model.app.models['Bucket'].findOne({where: { active: false } }));
    if(!bucket){
      let error = new Error()
      error.statusCode = 409
      error.code = 'NO_BUCKETS'
      error.name = 'No more buckets registered in system'
      error.message = 'There are no more buckets registered in the system, please contact to administrator.'
      return next(error);
    } 

    //Activate bucket and assign to resident
    [err, updatedBucket] = await to(bucket.updateAttributes({
      residentId: ctx.instance.id,
      active: true
    }))
    if(err){
      let error = new Error();
      error.statusCode = 409
      error.code = 'ERROR_UPDATING_BUCKET'
      error.name = 'Error updating bucket attributes'
      error.message = 'There was an error updating the bucket instance.'
      return next(error);
    }
            
    //Find assignment
    [err, assignment] = await to(Model.app.models['Assignment'].findById(ctx.req.params.fk))
    if(assignment.active===true){
      [err, updatedAssignment] = await to(assignment.updateAttributes({
        active: false,
        conciencityId: ctx.req.accessToken.userId,
        resolvedAt: new Date().toLocaleString()
      }))
      if(err){
        let error = new Error();
        error.statusCode = 409
        error.code = 'ERROR_UPDATING_ASSIGNMENT'
        error.name = 'Error updating assignment attributes'
        error.message = 'There was an error updating the assignment instance.'
        return next(error);
      }
      return next();
    }
  })


  /* Endpoint that add data to Resident */
  Resident.__post__data = function(id, cb){
    /*
    Steps: 
    1. findOrCreate RecolectionData with ResidentId 
    2. Create register with:
        - bucketId (for Resident)
        - recyclerId (from context)
        - scaleId (from scale active for recycler)
        - registerAt (date now)
        - weight : randon between 1 and 3 kg     
    */ 
    cb(null, id)
  };

  Resident.remoteMethod('__post__data', {
      accepts: {arg: 'id', type: 'string'},
      returns: {arg: 'data', type: 'object'},
      http: {verb: 'POST', path: '/:id/data'}
  });

  Resident.beforeRemote('__post__data', async function(ctx) {
    //1. Find or create recolectionData for Resident
    let err, recolectionData;
    // [err, recolectionData] = await to(Model.app.models['RecolectionData'].findOrCreate({residentId: ctx.args.id}));
    
    //Find resident with his bucket
    let resident;
    [err, resident] = await to(Resident.findOne({where:{_id: ctx.args.id}, include: {relation: 'bucket'}}));
    resident = resident.toJSON()
    //Find recycler with his scale
    let recycler;
    [err, recycler] = await to(Model.app.models['Recycler'].findOne({where: {_id: ctx.args.options.user.id}, include: {relation: 'scale'}}));
    recycler = recycler.toJSON()

    let data = {
      recyclerId: recycler.id,
      bucketId: resident.bucket.id,
      scaleId: recycler.scale.id,
      registerAt: new Date().toLocaleString(),
      weight: Math.floor(Math.random() * 5) + 1 
    }

    //Find or create RecolectionData for Resident, and add data register ;D
    Model.app.models['RecolectionData'].findOrCreate({residentId: ctx.args.id}, function(err, recolectionData) {
      debug('recolectionData: ', recolectionData);
      recolectionData.data.create(data, (err, data)=>{
        if(err) debug(err);
        debug('recolectionData with data: ', data)
      });
    });

  });
  

  //Disable Remote Methods 
  Resident.disableRemoteMethodByName('findOne');
};
