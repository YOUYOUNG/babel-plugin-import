"use strict";Object.defineProperty(exports, "__esModule", {value: true});var _path = require('path');
const fs = require('fs');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
var _helpermoduleimports = require('@babel/helper-module-imports');

function winPath(path2) {
  return path2.replace(/\\/g, "/");
}

class Plugin {
  constructor(libraryName, types, index = 0) {
    this.libraryName = libraryName;
    this.libraryFileName = libraryName.split('/').concat(['iclient-common']);
    this.types = types;
    this.pluginStateKey = `importPluginState${index}`;
    const libraryIndexFiles = this.parseModules(`${this.libraryFileName[0]}`, this.libraryFileName[1]);
    const commonIndexFiles = this.parseModules(`${this.libraryFileName[0]}`, this.libraryFileName[2]);
    this.dependencyFile = commonIndexFiles.concat(libraryIndexFiles);
  }
  getResolvePath(path) {
    return _path.resolve('./node_modules', path);
  }
  getExportLocalName(content, methodName) {
      let result = methodName;
      const ast = parser.parse(content, {sourceType: 'module'});
      traverse(ast, {
        ExportNamedDeclaration: ({node}) => {
          if(!node.source) {
            // export {xxx}  export {local as exported}
            node.specifiers.forEach(specifier=>{
               if(methodName === specifier.exported.name) {
                 result = specifier.local.name
               }
            })
          }
          // 有node.source.value ===  from
          // node.declaration ==> node.declaration.id.name:A  export class A//ClassDeclaration  export var //VariableDeclaration
          // if(node.declaration && node.declaration.id &&  node.declaration.id.name){
          //   // this.transformedMethodName = node.declaration.id.name; 
          // }
        },
        ExportDefaultDeclaration: ({node}) => {
          //class node.declaration.name   node.declartion.id.name
          // console.log('+++++++++++++++++++ExportDefaultDeclaration', node)
          // this.transformToDefaultImport = true;
        }
      })
    return result;
  }
  getSourceValue(content, methodName) {
    let result = {path: null, allEs:[], methodName, isDefault: false};
    const ast = parser.parse(content, {sourceType: 'module'});
    traverse(ast, {
      ExportNamedDeclaration: ({node}) => {
        if(node.source) {
          // export {xxx} from xxx  export {local as exported} from xxx
          node.specifiers.forEach(specifier=>{
             if(methodName === specifier.exported.name) {
               result.path = [node.source.value];
               result.methodName = specifier.local.name
             }
          })
        }
      },
      ImportDeclaration: ({node}) => {
        node.specifiers.forEach(specifier=>{
          // console.log('ImportDeclaration', specifier)
          if(methodName === specifier.local.name) {
            result.path = [node.source.value]
            if(specifier.type ==='ImportSpecifier') {
              // import {xxx} from "xxx"  import {xxx as xxx} from "xxx"
            }
            if(specifier.type ==='ImportDefaultSpecifier') {
              // import xxx from "xxx"
              result.isDefault = true;
            }
            if(specifier.type ==='ImportNamespaceSpecifier') {
              // import * as xxx from "xxx"
            }
          }
       })
      },
      ExportAllDeclaration: ({node}) => {
        // console.log('ExportAllDeclaration', node)
        result.allEs.push(node.source.value)
      }
    })
    return result;
  }
  getFileContentPath(content, methodName) {
    const realMethodName = this.getExportLocalName(content, methodName);
    const res = this.getSourceValue(content, realMethodName);
    console.log('-------------getFileContentPath', methodName, realMethodName,  res)
    return {...res, paths: res.path || res.allEs};
  }
  transformPath(path) {
    // console.log('transformPath', path)
    if(!path || path.includes('index.js')) {
      return path;
    }
    const index = path.indexOf(`/${this.libraryFileName[0]}/`);
    return path.substr(index + 1);
  }
  findPath(library, path, lastPath) {
    lastPath = winPath(lastPath)
    lastPath = lastPath.includes(`@supermap/${library}/index.js`) ? `@supermap/${library}/index.js`:lastPath
    const enty = this.dependencyFile.find(item => item.library === library && winPath(item.file) == lastPath);
    const { file, deps } = enty || {};
    return deps ? this.transformPath(deps[path]) : file;
  }
  getLibraryDirectory(path, methodName, transformToDefaultImport) {
    if(path && path.includes('index.js')) {
      const content = fs.readFileSync(path, 'utf-8').toString();
      const library = path.includes(this.libraryFileName[1])? this.libraryFileName[1]: this.libraryFileName[2];
      const {paths, methodName: realMethodName, isDefault} = this.getFileContentPath(content, methodName)
      for(let i = 0; i< paths.length;i++) {
        const absPath = this.findPath(library, paths[i], path)
        const res = this.getLibraryDirectory(absPath, realMethodName, isDefault);
        if(res && res.path) {
          return res;
        }
      }
    }else {
      console.log('$$$$$$$$$$else return', path, methodName)
      return {path, methodName, transformToDefaultImport};
    }
  }
  getLibraryEntryFile(){
    const content = fs.readFileSync(this.getResolvePath(this.libraryName + '/package.json')).toString();
    const mainFile = content.main || 'index.js';
    return this.getResolvePath(this.libraryName+'/'+mainFile);
  }
  isFile(path) {
    try {
      const stats = fs.statSync(this.getResolvePath(winPath(path)));
      return stats.isFile()
    }catch(e){
      return false;
    }
  }
  traverseCallback(node, dirname, deps) {
    if(!node || !node.source) {
      return;
    }
    const sourceValue = node.source.value;
    const abspath = _path.join(dirname, sourceValue, 'index.js');
    const abspath1 = _path.join(dirname, sourceValue + '.js');
    if(this.isFile(abspath)) {
      deps[sourceValue] = winPath(abspath)
    }
    if(this.isFile(abspath1)) {
      deps[sourceValue] = winPath(abspath1)
    }
  }
  getModuleInfo(file, library){
    if(!file.match(/index.js$/)) {
      return;
    }
    const libraryFile = `${this.libraryName}/index.js`;
    const commonFile = `${this.libraryFileName[0]}/${this.libraryFileName[2]}`;
    const resolvePath = this.getResolvePath(file);
    const dirname = winPath(_path.dirname(resolvePath));
    const fileContent = fs.readFileSync(resolvePath,'utf-8').toString();
    const ast = parser.parse(fileContent, {sourceType: 'module'});
    const deps = {};
    if(library === this.libraryFileName[1] && file === libraryFile) {
      deps[`${commonFile}`] = winPath(this.getResolvePath(`${commonFile}/index.js`));
    }
    traverse(ast, {
      ImportDeclaration: ({node}) => this.traverseCallback(node, dirname, deps),
      ExportNamedDeclaration: ({node}) => this.traverseCallback(node, dirname, deps),
      ExportAllDeclaration: ({node}) => this.traverseCallback(node, dirname, deps)
    })
    return {file, deps, library};
  }
  parseModules(folder, library){
    const entry = this.getModuleInfo(`${folder}/${library}/index.js`, library)
    const temp = [entry]
    for (let i = 0;i<temp.length;i++){
      if(!temp[i]){
        continue;
      }
        const deps = temp[i].deps
        if (deps){
            for (const key in deps){
                if (deps.hasOwnProperty(key)){
                    const val = this.getModuleInfo(deps[key], library);
                    val && temp.push(val)
                }
            }
        }
    }
    return temp;
  }
  getPluginState(state) {
    if (!state[this.pluginStateKey]) {
      state[this.pluginStateKey] = {};
    }
    return state[this.pluginStateKey];
  }
  importMethod(methodName, file, pluginState) {
    this.transformedMethodName = null;
    this.transformToDefaultImport = false;
    console.log('importMethod', methodName)
    if (!pluginState.selectedMethods[methodName]) {
      let { path: libraryDirectory, methodName: transformedMethodName, transformToDefaultImport} = this.getLibraryDirectory(this.getLibraryEntryFile(), methodName);
      if(!libraryDirectory) {
        throw new Error(`${methodName} not found in "${this.libraryName}"`);
      }
      console.log('------------------------------libraryDirectory', libraryDirectory, methodName, transformedMethodName, transformToDefaultImport )
      const path2 = winPath(_path.join.call(void 0, libraryDirectory));
      pluginState.selectedMethods[methodName] = transformToDefaultImport ? _helpermoduleimports.addDefault.call(void 0, file.path, path2, {nameHint: transformedMethodName}) : _helpermoduleimports.addNamed.call(void 0, file.path, transformedMethodName, path2);
    }
    return {...pluginState.selectedMethods[methodName]};
  }
  buildExpressionHandler(node, props, path2, state) {
    const file = path2 && path2.hub && path2.hub.file || state && state.file;
    const {types} = this;
    const pluginState = this.getPluginState(state);
    props.forEach((prop) => {
      if (!types.isIdentifier(node[prop]))
        return;
      if (pluginState.specified[node[prop].name] && types.isImportSpecifier(path2.scope.getBinding(node[prop].name).path)) {
        node[prop] = this.importMethod(pluginState.specified[node[prop].name], file, pluginState);
      }
    });
  }
  buildDeclaratorHandler(node, prop, path2, state) {
    const file = path2 && path2.hub && path2.hub.file || state && state.file;
    const {types} = this;
    const pluginState = this.getPluginState(state);
    const checkScope = (targetNode) => pluginState.specified[targetNode.name] && path2.scope.hasBinding(targetNode.name) && path2.scope.getBinding(targetNode.name).path.type === "ImportSpecifier";
    if (types.isIdentifier(node[prop]) && checkScope(node[prop])) {
      node[prop] = this.importMethod(pluginState.specified[node[prop].name], file, pluginState);
    } else if (types.isSequenceExpression(node[prop])) {
      node[prop].expressions.forEach((expressionNode, index) => {
        if (types.isIdentifier(expressionNode) && checkScope(expressionNode)) {
          node[prop].expressions[index] = this.importMethod(pluginState.specified[expressionNode.name], file, pluginState);
        }
      });
    }
  }
  ProgramEnter(path2, state) {
    const pluginState = this.getPluginState(state);
    pluginState.specified = Object.create(null);
    pluginState.libraryObjs = Object.create(null);
    pluginState.selectedMethods = Object.create(null);
    pluginState.pathsToRemove = [];
  }
  ProgramExit(path2, state) {
    this.getPluginState(state).pathsToRemove.forEach((p) => !p.removed && p.remove());
  }
  ImportDeclaration(path2, state) {
    const {node} = path2;
    if (!node)
      return;
    const {value} = node.source;
    const {libraryName} = this;
    const {types} = this;
    const pluginState = this.getPluginState(state);
    if (value === libraryName) {
      console.log('------------',value)
      node.specifiers.forEach((spec) => {
        if (types.isImportSpecifier(spec)) {
          pluginState.specified[spec.local.name] = spec.imported.name;
        } else {
          pluginState.libraryObjs[spec.local.name] = true;
        }
        
      });
      pluginState.pathsToRemove.push(path2);
    }
  }
  CallExpression(path2, state) {
    const {node} = path2;
    const file = path2 && path2.hub && path2.hub.file || state && state.file;
    const {name} = node.callee;
    const {types} = this;
    const pluginState = this.getPluginState(state);
    if (types.isIdentifier(node.callee)) {
      if (pluginState.specified[name]) {
        node.callee = this.importMethod(pluginState.specified[name], file, pluginState);
      }
    }
    node.arguments = node.arguments.map((arg) => {
      const {name: argName} = arg;
      if (pluginState.specified[argName] && path2.scope.hasBinding(argName) && path2.scope.getBinding(argName).path.type === "ImportSpecifier") {
        return this.importMethod(pluginState.specified[argName], file, pluginState);
      }
      return arg;
    });
  }
  MemberExpression(path2, state) {
    const {node} = path2;
    const file = path2 && path2.hub && path2.hub.file || state && state.file;
    const pluginState = this.getPluginState(state);
    if (!node.object || !node.object.name)
      return;
    if (pluginState.libraryObjs[node.object.name]) {
      path2.replaceWith(this.importMethod(node.property.name, file, pluginState));
    } else if (pluginState.specified[node.object.name] && path2.scope.hasBinding(node.object.name)) {
      const {scope} = path2.scope.getBinding(node.object.name);
      if (scope.path.parent.type === "File") {
        node.object = this.importMethod(pluginState.specified[node.object.name], file, pluginState);
      }
    }
  }
  Property(path2, state) {
    const {node} = path2;
    this.buildDeclaratorHandler(node, "value", path2, state);
  }
  VariableDeclarator(path2, state) {
    const {node} = path2;
    this.buildDeclaratorHandler(node, "init", path2, state);
  }
  ArrayExpression(path2, state) {
    const {node} = path2;
    const props = node.elements.map((_, index) => index);
    this.buildExpressionHandler(node.elements, props, path2, state);
  }
  LogicalExpression(path2, state) {
    const {node} = path2;
    this.buildExpressionHandler(node, ["left", "right"], path2, state);
  }
  ConditionalExpression(path2, state) {
    const {node} = path2;
    this.buildExpressionHandler(node, ["test", "consequent", "alternate"], path2, state);
  }
  IfStatement(path2, state) {
    const {node} = path2;
    this.buildExpressionHandler(node, ["test"], path2, state);
    this.buildExpressionHandler(node.test, ["left", "right"], path2, state);
  }
  ExpressionStatement(path2, state) {
    const {node} = path2;
    const {types} = this;
    if (types.isAssignmentExpression(node.expression)) {
      this.buildExpressionHandler(node.expression, ["right"], path2, state);
    }
  }
  ReturnStatement(path2, state) {
    const {node} = path2;
    this.buildExpressionHandler(node, ["argument"], path2, state);
  }
  ExportDefaultDeclaration(path2, state) {
    const {node} = path2;
    this.buildExpressionHandler(node, ["declaration"], path2, state);
  }
  BinaryExpression(path2, state) {
    const {node} = path2;
    this.buildExpressionHandler(node, ["left", "right"], path2, state);
  }
  NewExpression(path2, state) {
    const {node} = path2;
    this.buildExpressionHandler(node, ["callee", "arguments"], path2, state);
  }
  SwitchStatement(path2, state) {
    const {node} = path2;
    this.buildExpressionHandler(node, ["discriminant"], path2, state);
  }
  SwitchCase(path2, state) {
    const {node} = path2;
    this.buildExpressionHandler(node, ["test"], path2, state);
  }
  ClassDeclaration(path2, state) {
    const {node} = path2;
    this.buildExpressionHandler(node, ["superClass"], path2, state);
  }
} exports.default = Plugin;
