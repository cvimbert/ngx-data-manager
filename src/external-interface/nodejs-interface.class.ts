/**
 * Created by reunion on 19/05/2017.
 */

import {ExternalInterface} from "./external-interface.interface";
import {Observable, BehaviorSubject, ReplaySubject, Subscription} from "rxjs/Rx";
import {DataEntity} from "../data-entity.class";
import {DataEntityCollection} from "../data-entity-collection.class";
import {Response} from "@angular/http";
import {NodeJSInterfaceConfig} from "./nodejs-interface-config.interface";
import {DataManagerService} from "../data-manager.service";
import * as io from 'socket.io-client';
import * as uuid from "uuid";
import {NodeJsDataInterface} from "./nodejs-data.interface";

export class NodeJsInterface implements ExternalInterface {

    socket;
    messageSubject:ReplaySubject<NodeJsDataInterface[]>;
    wallSubject:ReplaySubject<NodeJsDataInterface[]>;

    collectionSubscriptions:Subscription[];

    messageEventType:string;
    wallEventType:string;

    constructor(
        private manager:DataManagerService,
        private configuration:NodeJSInterfaceConfig
    ) {
        this.messageEventType = configuration.messageEvent ? configuration.messageEvent : "message";
        this.wallEventType = configuration.wallEvent ? configuration.wallEvent : "retrieveMur";


        this.init();
    }

    init() {
        this.messageSubject = new ReplaySubject<NodeJsDataInterface[]>(1);
        this.wallSubject = new ReplaySubject<NodeJsDataInterface[]>(1);
    }

    initializeSocket() {
        this.socket = io.connect(this.configuration.socketUrl);

        this.socket.on(this.messageEventType, (data:NodeJsDataInterface[]) => {
            console.log("MESSAGE DATA: ", data);
            this.messageSubject.next(data);
        });

        this.socket.on(this.wallEventType, (data:NodeJsDataInterface[]) => {
            console.log("WALL DATA", data);
            this.wallSubject.next(data);
        });
    }

    clearSocket() {
        this.socket.off(this.messageEventType);
        this.socket.off(this.wallEventType);

        this.socket.disconnect();

        this.socket = null;
    }

    getWallAndTypeFilteredObservable(entityType:string, wall:string):Observable<DataEntityCollection> {
        return this.wallSubject.map(this.filterCollectionData, { type: entityType, wall: wall, self: this });
    }

    /*getTypeFilteredObservable(entityType:string):Observable<DataEntityCollection> {

    }*/
    
    getMappedEntitiesDatas(command:string):Observable<DataEntity[]> {
        return this.messageSubject.map(this.filterEntityData, { self: this, command: command });
    }

    /*getUuidFilteredObservable(entityType:string, uid:string):Observable<NodeJsDataInterface[]> {
        return this.messageSubject.filter((data:NodeJsDataInterface[]) => {
            return data.type === entityType && data.uuid === uid;
        });
    }*/

    filterCollectionData(data:NodeJsDataInterface[]):DataEntityCollection {
        // filter on "mur" and "type"
        var filteredData:NodeJsDataInterface[] = [];

        data.forEach((itemData:NodeJsDataInterface) => {
            if (this["wall"] === itemData.mur && this["type"] === itemData.type) {
                filteredData.push(itemData);
            }
        });

        return this["self"].mapToCollection(this["type"], filteredData);
    }
    
    filterEntityData(data:NodeJsDataInterface[]):DataEntity[] {
        var entities:DataEntity[] = [];
        
        data.forEach((itemData:NodeJsDataInterface) => {
            if (itemData.command === this["command"]) {
                entities.push(this["self"].mapToEntity(itemData));
            }
        });
        
        return entities;
    }

    mapToCollection(entityType:string, data:NodeJsDataInterface[]):DataEntityCollection {

        var mapData:Object[] = [];

        data.forEach((itemData:NodeJsDataInterface) => {
            mapData.push(itemData.data);
        });

        return new DataEntityCollection(mapData, entityType, this.manager);
    }
    
    mapToEntity(data:NodeJsDataInterface):DataEntity {
        var entity:DataEntity = new DataEntity(data.data, data.type, this.manager);
        entity.set("wallid", data.mur);
        return entity;
    }

    getEntity(entityType:string):Observable<DataEntity> {
         return null;
    }

    loadEntity(entityType:string, entityId:any):Observable<DataEntity> {
        return null;
    }

    saveEntity(entity:DataEntity, applyDiff:boolean):Observable<DataEntity> {

        var requestData:NodeJsDataInterface = {
            command: "update",
            data: entity.attributes,
            mur: entity.get("wallid"),
            type: entity.type
        };

        console.log("SAVE", requestData);

        this.socket.emit("message", requestData);

        return new BehaviorSubject<DataEntity>(entity);
    }

    saveRawEntity(entity:DataEntity):Observable<DataEntity> {
        return null;
    }

    loadEntityCollection(entityType:string, fields:Array<string>, params:Object = null):Observable<DataEntityCollection> {

        if (!this.socket) {
            this.initializeSocket();
        }

        this.collectionSubscriptions = [];

        if (params && params["wallid"]) {
            this.socket.emit('connexion', params["wallid"]);
        } else {
            this.socket.emit(entityType);
        }
        
        let putSubscription:Subscription = this.getMappedEntitiesDatas("put").subscribe((entities:DataEntity[]) => {
            entities.forEach((entity:DataEntity) => {
                this.manager.checkAndRegisterEntity(entity);
            });
        });

        this.collectionSubscriptions.push(putSubscription);

        let updateSubscription:Subscription = this.getMappedEntitiesDatas("update").subscribe((entities:DataEntity[]) => {
            entities.forEach((entity:DataEntity) => {
                this.manager.checkAndRegisterEntity(entity);
            });
        });

        this.collectionSubscriptions.push(updateSubscription);

        let deleteSubscription:Subscription = this.getMappedEntitiesDatas("delete").subscribe((entities:DataEntity[]) => {
            entities.forEach((entity:DataEntity) => {
                this.manager.deleteAction(entity);
            });
        });

        this.collectionSubscriptions.push(deleteSubscription);

        var obs:Observable<DataEntityCollection> = this.getWallAndTypeFilteredObservable(entityType, "test1");

        obs.subscribe(coll => console.log("COLLECTION DE BASE", coll));

        return this.getWallAndTypeFilteredObservable(entityType, "test1");
    }

    clearCollectionSubscriptions() {
        this.collectionSubscriptions.forEach((subscription:Subscription) => {
            subscription.unsubscribe();
        });

        this.collectionSubscriptions = [];
    }

    createEntity(entityType:string, datas:Object):Observable<DataEntity> {
        return this.putEntity(entityType, datas);
    }

    generateTempId():number {
        return Math.floor(Math.random() * 100000);
    }

    putEntity(entityType:string, datas:Object):Observable<DataEntity> {

        if (!datas["id"]) {
            datas["id"] = this.generateTempId();
        }

        var uid:string = uuid.v4();

        var requestData:NodeJsDataInterface = {
            command: "put",
            data: datas,
            mur: "test1",
            type: entityType,
            uuid: uid
        };

        this.socket.emit("message", requestData);
        var dt:DataEntity = new DataEntity(datas, entityType, this.manager);

        this.manager.entitiesCollectionsCache[entityType].entitiesObservables.push(new BehaviorSubject<DataEntity>(dt));
        this.manager.entitiesCollectionsCache[entityType].dataEntities.push(dt);

        return new BehaviorSubject<DataEntity>(this.mapToEntity(requestData));
    }

    deleteEntity(entity:DataEntity):Observable<Response> {

        let requestData:NodeJsDataInterface = {
            command: "delete",
            data: entity.attributes,
            mur: "test1",
            type: entity.type
        };

        this.socket.emit("message", requestData);
        
        return new BehaviorSubject<Response>(null);
    }

    duplicateEntity(entity:DataEntity):Observable<DataEntity> {
        return null;
    }

    release() {
        this.clearCollectionSubscriptions();
        this.clearSocket();
    }
}