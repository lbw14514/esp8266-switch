'use strict';
'require view';
'require rpc';
'require ui';
'require poll';

var callDevices = rpc.declare({
	object: 'esp-switch',
	method: 'devices',
	params: [ 'scan' ],
	expect: {}
});

var callPulse = rpc.declare({
	object: 'esp-switch',
	method: 'pulse',
	params: [ 'address', 'ch', 'ms' ],
	expect: {}
});

var callSave = rpc.declare({
	object: 'esp-switch',
	method: 'save',
	params: [ 'id', 'name', 'address', 'ch1', 'ch2', 'ch3', 'ch4' ],
	expect: {}
});

var callRemove = rpc.declare({
	object: 'esp-switch',
	method: 'remove',
	params: [ 'id' ],
	expect: {}
});

var callSettings = rpc.declare({
	object: 'esp-switch',
	method: 'settings',
	params: [ 'pulse_ms', 'discover_timeout' ],
	expect: {}
});

return view.extend({
	pulseMs: 500,
	rows: null,

	load: function() {
		return callDevices('1');
	},

	channelNames: function(dev) {
		var names = [ dev.ch1, dev.ch2, dev.ch3, dev.ch4 ];
		var out = [];
		for (var i = 0; i < 4; i++)
			out.push((names[i] && names[i].length) ? names[i] : String.fromCharCode(65 + i));
		return out;
	},

	channelPins: function(dev) {
		return [ dev.pin1, dev.pin2, dev.pin3, dev.pin4 ];
	},

	makePulseButton: function(dev, index, label) {
		var self = this;
		return E('button', {
			'class': 'btn cbi-button cbi-button-apply',
			'title': '触发通道 ' + (index + 1),
			'click': function() {
				return callPulse(dev.address, String(index + 1), String(self.pulseMs)).then(function(res) {
					if (!res || res.ok != 1)
						ui.addNotification(null, E('p', {}, [ '触发失败：' + ((res && res.error) || '设备不可达') ]), 'error');
				});
			}
		}, [ label ]);
	},

	makeRow: function(dev) {
		var self = this;
		var names = this.channelNames(dev);
		var pins = this.channelPins(dev);
		var input = E('input', {
			'type': 'text',
			'class': 'cbi-input-text',
			'value': dev.name || dev.id,
			'style': 'width:12em'
		});
		var status = E('span', {
			'class': 'label ' + (dev.online == 1 ? 'success' : 'warning')
		}, [ dev.online == 1 ? '在线' : '离线' ]);
		var chInputs = [], chPins = [], buttons = [];
		for (var i = 0; i < 4; i++) {
			var chInput = E('input', {
				'type': 'text',
				'class': 'cbi-input-text',
				'value': names[i],
				'style': 'width:6em'
			});
			var pin = E('span', { 'class': 'cbi-value-description' },
				[ pins[i] ? 'GPIO' + pins[i] : '未探测' ]);
			var btn = this.makePulseButton(dev, i, names[i]);
			chInputs.push(chInput);
			chPins.push(pin);
			buttons.push(btn);
		}
		var channels = [];
		for (var j = 0; j < 4; j++)
			channels.push(E('div', { 'style': 'display:flex;gap:6px;align-items:center' },
				[ chInputs[j], chPins[j], buttons[j] ]));
		var row = E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, [ input ]),
			E('td', { 'class': 'td' }, [ status, E('br'), E('span', { 'class': 'cbi-value-description' }, [ dev.address || '-' ]) ]),
			E('td', { 'class': 'td' }, channels),
			E('td', { 'class': 'td', 'style': 'white-space:nowrap' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-save',
					'click': function() {
						return callSave(dev.id, input.value, dev.address,
							chInputs[0].value, chInputs[1].value, chInputs[2].value, chInputs[3].value).then(function(res) {
							if (!res || res.ok != 1) {
								ui.addNotification(null, E('p', {}, [ '保存失败' ]), 'error');
								return;
							}
							ui.addNotification(null, E('p', {}, [
								res.pushed == 1 ? '已保存并同步到设备' : '已保存（设备离线，未同步）'
							]));
							return self.refresh();
						});
					}
				}, [ '保存' ]),
				' ',
				E('button', {
					'class': 'btn cbi-button cbi-button-remove',
					'click': function() {
						if (!confirm('移除设备 ' + (dev.name || dev.id) + ' ？'))
							return Promise.resolve();
						return callRemove(dev.id).then(function() {
							return self.refresh();
						});
					}
				}, [ '移除' ])
			])
		]);
		row.__parts = {
			nameInput: input,
			status: status,
			addr: row.children[1].lastChild,
			chInputs: chInputs,
			chPins: chPins,
			buttons: buttons
		};
		return row;
	},

	updateRows: function(list) {
		var body = this.body;
		var devices = (list && list.devices) ? list.devices : [];
		var ids = devices.map(function(d) { return d.id; }).join(',');
		if (this.rows !== ids || !this.parts) {
			this.rows = ids;
			this.parts = {};
			while (body.firstChild)
				body.removeChild(body.firstChild);
			for (var i = 0; i < devices.length; i++) {
				var newRow = this.makeRow(devices[i]);
				body.appendChild(newRow);
				this.parts[devices[i].id] = newRow.__parts;
			}
			return;
		}
		for (var j = 0; j < devices.length; j++) {
			var dev = devices[j];
			var parts = this.parts[dev.id];
			if (!parts)
				continue;
			parts.status.textContent = dev.online == 1 ? '在线' : '离线';
			parts.status.className = 'label ' + (dev.online == 1 ? 'success' : 'warning');
			parts.addr.textContent = dev.address || '-';
			if (document.activeElement !== parts.nameInput)
				parts.nameInput.value = dev.name || dev.id;
			var names = this.channelNames(dev);
			var pins = this.channelPins(dev);
			for (var k = 0; k < 4; k++) {
				if (document.activeElement !== parts.chInputs[k])
					parts.chInputs[k].value = names[k];
				parts.chPins[k].textContent = pins[k] ? 'GPIO' + pins[k] : '未探测';
				parts.buttons[k].textContent = names[k];
			}
		}
	},

	refresh: function(scan) {
		var self = this;
		return callDevices(scan ? '1' : '0').then(function(list) {
			self.updateRows(list);
		});
	},

	render: function(data) {
		var self = this;
		var table = E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, [ '设备' ]),
				E('th', { 'class': 'th' }, [ '状态' ]),
				E('th', { 'class': 'th' }, [ '通道名称 / 引脚 / 短接触发' ]),
				E('th', { 'class': 'th' }, [ '操作' ])
			])
		]);
		this.body = E('tbody', {});
		table.appendChild(this.body);
		this.updateRows(data);

		var pulseInput = E('input', {
			'type': 'text',
			'class': 'cbi-input-text',
			'value': String(this.pulseMs),
			'style': 'width:6em'
		});

		poll.add(function() {
			return self.refresh(false);
		}, 10);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ 'ESP 开关' ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				'自动发现局域网内广播 _esp-switch._tcp 的设备，可自定义每路名称，按钮会把对应引脚拉低 ',
				String(this.pulseMs), ' 毫秒（短接主板电源开关）'
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, [ '脉冲时长 (ms)' ]),
					E('div', { 'class': 'cbi-value-field' }, [
						pulseInput,
						' ',
						E('button', {
							'class': 'btn cbi-button cbi-button-save',
							'click': function() {
								self.pulseMs = parseInt(pulseInput.value, 10) || 500;
								pulseInput.value = String(self.pulseMs);
								return callSettings(String(self.pulseMs), '').then(function() {
									ui.addNotification(null, E('p', {}, [ '已保存脉冲时长' ]));
								});
							}
						}, [ '保存' ]),
						' ',
						E('button', {
							'class': 'btn cbi-button cbi-button-action',
							'click': function() {
								return self.refresh(true).then(function() {
									ui.addNotification(null, E('p', {}, [ '扫描完成' ]));
								});
							}
						}, [ '扫描设备' ])
					])
				])
			]),
			E('div', { 'class': 'cbi-section' }, [ table ])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
