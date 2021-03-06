// # sim-grid.js
"use strict";
const bsearch = require('binary-search-bounds');
const Stream = require('./stream');
const WriteStream = require('./write-stream');
const crc32 = require('./crc');
const { chunk } = require('./util');

const TypedArrays = {
	0x49b9e602: Uint8Array,
	0x49b9e603: Int8Array,
	0x49b9e604: Uint16Array,
	0x49b9e605: Int16Array,
	0x49b9e606: Uint32Array,
	0x49b9e60a: Float32Array
};
const Readers = {
	0x49b9e602: Stream.prototype.uint8,
	0x49b9e603: Stream.prototype.int8,
	0x49b9e604: Stream.prototype.uint16,
	0x49b9e605: Stream.prototype.int16,
	0x49b9e606: Stream.prototype.uint32,
	0x49b9e60a: Stream.prototype.float
};

// # SimGridFile
// The class representing a SimGrid file (could be any of the different types, 
// general structure is the same anyway). It holds several sim grids 
// internally.


class SimGridFile {

	// ## constructor()
	constructor() {
		this.grids = [];
		this.sorted = [];
	}

	// ## parse(buff)
	parse(buff) {
		let rs = new Stream(buff);
		let grids = this.grids;
		grids.length = 0;
		while (!rs.eof()) {
            
			let grid = new SimGrid();
			grid.parse(rs);
			grids.push(grid);
		}
        console.log("grid length =" +  this.grids.length);  
		this.sorted = this.grids.map(x => x).sort(compare);

	}

	// ## *[Symbol.iterator]
	*[Symbol.iterator]() {
		yield* this.grids;
	}

	// ## toBuffer(opts)
	toBuffer(opts) {
		return Buffer.concat(Array.from(this.bgen(opts)));
	}

	// ## *bgen(opts)
	*bgen(opts) {
		for (let grid of this) {
			yield* grid.bgen();
		}
	}

	// ## get(dataId)
	// Returns the grid for the given data Id.
	get(dataId) {
		let index = bsearch.eq(this.sorted, { dataId }, compare);
		return index > -1 ? this.sorted[index] : null;
	}


}
module.exports = SimGridFile;

// Comparator function used to sort grids.
function compare(a, b) {
	return a.dataId - b.dataId;
}

// # SimGrid
const SimGrid = SimGridFile.SimGrid = class SimGrid {

	// ## constructor()
	constructor() {

		// Note: I think some of the unknowns identifies the data type, where 
		// 0x01 is UInt8 etc. Not sure though, we should investigate this 
		// deeper.
		this.crc = 0x00000000;
		this.mem = 0x00000000;
		this.major = 0x0001;
		this.u1 = 0x01;
		this.type = 0x00000000;
		this.dataId = 0x00000000;
		this.resolution = 0x00000001;
		this.resolutionPower = 0x00000000;
		this.xSize = 0x00000040;
		this.zSize = 0x00000040;
		this.u6 = 0x00000000;
		this.u7 = 0x00000000;
		this.u8 = 0x00000000;
		this.u9 = 0x00000000;
		this.data = null;
	}

	// ## parse(rs)
	parse(rs) {
		let start = rs.i; // rs is uint32 stream
		let size = rs.dword();
		this.crc = rs.dword();
		this.mem = rs.dword();
		this.major = rs.word();
		this.u1 = rs.byte();
        //-> from here
		this.type = rs.dword();
		this.dataId = rs.dword();
		this.resolution = rs.dword();
		this.resolutionPower = rs.dword();
		this.xSize = rs.dword();
		this.zSize = rs.dword();
		this.u6 = rs.dword();
		this.u7 = rs.dword();
		this.u8 = rs.dword();
		this.u9 = rs.dword();
        // <- to here i have the same 
		// Don't know if multiple values are possible here, the SInt8 does 
		// some pretty weird stuff... Anyway, for now we'll just read in the 
		// rest into the appropriate underlying array type.
		// Note: we could directly copy the arraybuffer, but it's pretty error 
		// prone apparently, especially with the offsets and stuff. Hence 
		// we'll write in manually.
		const Typed = TypedArrays[ this.type ];
		const reader = Readers[ this.type ];
		const count = this.xSize * this.zSize;
		let data = this.data = new Typed(count);
    
		for (let i = 0; i < count; i++) {
			data[i] = reader.call(rs);
        
		}
       

		// Ensure that we've read everything correctly.
		let diff = rs.i - start;
		if (diff !== size) {
			console.warn([
				'Error while reading SimGrid!',
				`Expected ${size} bytes, but read ${diff}!`
			]);
		}

		// Done! Easy data access is available by calling createProxy(). Using 
		// this it's possible to access the data as if it were a 
		// multidimensional array.
		return this;

	}

	// ## toBuffer(opts)
	toBuffer(opts) {
		return this.bgen(opts).next().value;
	}

	// ## *bgen(opts)
	*bgen(opts) {

		// Pre-allocate the header.
		let header = Buffer.allocUnsafe(55);
		let ws = new WriteStream(header);
		ws.jump(8);
		ws.dword(this.mem);
		ws.word(this.major);
		ws.byte(this.u1);
		ws.dword(this.type);
		ws.dword(this.dataId);
		ws.dword(this.resolution);
		ws.dword(this.resolutionPower);
		ws.dword(this.xSize);
		ws.dword(this.zSize);
		ws.dword(this.u6);
		ws.dword(this.u7);
		ws.dword(this.u8);
		ws.dword(this.u9);

		// Use the underlying buffer of our data view. At least on LE systems 
		// this should be good to be used directly.
		let data = Buffer.from(this.data.buffer);

		// Concatenate & calculate crc.
		let out = Buffer.concat([header, data]);
		out.writeUInt32LE(out.byteLength, 0);
		out.writeUInt32LE(crc32(out, 8), 4);

		yield out;

	}

	// ## get(x, z)
	// Returns the value stored in cell (x, z)
    printdata()
    {
        var fs = require('fs');
        var logStream = fs.createWriteStream('C:\\Users\\Gaël\\Documents\\log.txt', {flags: 'a'});
        const count = this.xSize * this.zSize;
		for (let i = 0; i < count; i++) {
			logStream.write(this.data[i].toString() + " ");  
        
		}
        
         logStream.end('this is the end line');
        
    }
    printGridInfo()
    {
        
        console.log("memory_address :" + this.mem )
         console.log("Major_version :" + this.major )
         console.log("Unknown_1 :" + this.u1 )
         console.log("Type_ID :" + this.type )
         console.log("Data_ID :" + this.dataId )
         console.log("Resolution :" + this.resolution )
         console.log("Resolution_power :" + this.resolutionPower )
         console.log("X_Size :" + this.xSize )
         console.log("Y_Size :" + this.ySize )
         console.log("Unknown_6 :" + this.u6 )
         console.log("Unknown_7 :" + this.u7 )
         console.log("Unknown_8 :" + this.u8 )
         console.log("Unknown_9 :" + this.u9 )
    }
	get(x, z) {
		let { zSize } = this;
        var nn = x*zSize + z;
        console.log(nn);
		return this.data[ x*zSize + z ];
	}

	// ## set(x, z)
	// Sets the value stored in cell (x, z)
	set(x, z, value, debug = false) {
		this.data[ x*this.zSize+z ] = value;
        if ( debug )
        {
        //   console.log("u1" +  this.u1) ;
      //  console.log("generated value = " + value); // trigger enormememnt
        }
		return this;
	}

	// ## createProxy()
	// Creates a data proxy so that we can access the data in an array-like 
	// way.
	createProxy() {
		return new Proxy(this, {
			get(target, prop, receiver) {
				let x = +prop;
				return new Proxy(target, {
					get(target, prop, receiver) {
						let z = +prop;
						let { zSize, data} = target;
						return data[ x*zSize + z];
					}
				});
			}
		});
	}

	// ## paint()
	// Creates a visual representation of the sim grid on a canvas. Of course 
	// this can only be used in HTML environments that properly support canvas!
	paint() {
		let canvas = document.createElement('canvas');
		canvas.width = this.xSize;
		canvas.height = this.zSize;

		// Find the max value in the data.
		const data = this.data;
		let max = Math.max(...data);
		if (max === 0) max = 1;

		// Create a canvas context.
		let ctx = canvas.getContext('2d');
		let imgData = ctx.createImageData(canvas.width, canvas.height);

		// Fill up the image data. Note that we have to flip unfortunately, 
		// but that's manageable.
		for (let z = 0; z < this.zSize; z++) {
			for (let x = 0; x < this.xSize; x++) {
				let value = data[ x*this.zSize+z ];
				let offset = 4*(z*this.xSize+x);
				let alpha = (value / max)*0xff;
				imgData.data[offset+3] = alpha;
			}
		}
		ctx.putImageData(imgData, 0, 0);

		return canvas;

	}

}