'use strict';
'require view';
'require rpc';
'require ui';
'require poll';

var callDevices = rpc.declare({
	object: 'esp-switch',
	method: 'devices',
	params: [ 'scan', 'probe' ],
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
	params: [ 'id', 'name', 'address',
		'ch1', 'ch2', 'ch3',
		'a1', 'b1', 'a2', 'b2', 'a3', 'b3' ],
	expect: {}
});

var CH_COUNT = 3;

var callRemove = rpc.declare({
	object: 'esp-switch',
	method: 'remove',
	params: [ 'id' ],
	expect: {}
});

var callReject = rpc.declare({
	object: 'esp-switch',
	method: 'reject',
	params: [ 'id' ],
	expect: {}
});

var callApprove = rpc.declare({
	object: 'esp-switch',
	method: 'approve',
	params: [ 'id', 'name', 'address' ],
	expect: {}
});

var callRestore = rpc.declare({
	object: 'esp-switch',
	method: 'restore',
	expect: {}
});

var ignoreDevice = function(id) {
	return callReject(id).catch(function() {
		return callRemove(id);
	});
};

var restoreIgnored = function() {
	return callRestore().catch(function() {
		return callRemove('*');
	});
};

var pairDevice = function(p) {
	var name = p.name || p.id;
	return callApprove(p.id, name, p.address).catch(function() {
		return callSave(p.id, name, p.address);
	});
};

var callSettings = rpc.declare({
	object: 'esp-switch',
	method: 'settings',
	params: [ 'pulse_ms', 'discover_timeout', 'webui_password' ],
	expect: {}
});

return view.extend({
	pulseMs: 500,
	rows: null,
	asking: false,

	load: function() {
		return callDevices('0', '0');
	},

	channelNames: function(dev) {
		var names = [ dev.ch1, dev.ch2, dev.ch3 ];
		var out = [];
		for (var i = 0; i < CH_COUNT; i++)
			out.push((names[i] && names[i].length) ? names[i] : String.fromCharCode(65 + i));
		return out;
	},

	pinList: function(dev) {
		if (dev.pins && dev.pins.length)
			return dev.pins.split(',');
		return [ '4', '5', '12', '13', '14', '16' ];
	},

	pinSet: function(v) {
		return v != null && v !== '' && v != -1 && v != '-1' && v != 'none';
	},

	channelPinPairs: function(dev) {
		return [ [ dev.a1, dev.b1 ], [ dev.a2, dev.b2 ], [ dev.a3, dev.b3 ] ];
	},

	availablePins: function(pool, pairs, chIndex, slot) {
		var used = {};
		for (var i = 0; i < CH_COUNT; i++) {
			for (var k = 0; k < 2; k++) {
				if (i === chIndex && k === slot)
					continue;
				if (this.pinSet(pairs[i][k]))
					used[String(pairs[i][k])] = 1;
			}
		}
		var out = [];
		for (var j = 0; j < pool.length; j++) {
			if (!used[String(pool[j])])
				out.push(pool[j]);
		}
		var cur = pairs[chIndex][slot];
		if (this.pinSet(cur) && out.indexOf(String(cur)) < 0)
			out.push(String(cur));
		out.sort(function(a, b) { return Number(a) - Number(b); });
		return out;
	},

	makePinSelect: function() {
		return E('select', { 'class': 'cbi-input-select', 'style': 'width:7em' });
	},

	fillSelect: function(sel, list, value) {
		while (sel.firstChild)
			sel.removeChild(sel.firstChild);
		var set = this.pinSet(value);
		sel.appendChild(E('option', { 'value': '', 'selected': set ? null : 'selected' }, [ '未使用' ]));
		var found = false;
		for (var i = 0; i < list.length; i++) {
			var hit = set && String(list[i]) == String(value);
			if (hit)
				found = true;
			sel.appendChild(E('option', {
				'value': list[i],
				'selected': hit ? 'selected' : null
			}, [ 'GPIO' + list[i] ]));
		}
		if (set && !found)
			sel.appendChild(E('option', { 'value': String(value), 'selected': 'selected' }, [ 'GPIO' + value ]));
		sel.value = set ? String(value) : '';
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
		var pairs = this.channelPinPairs(dev);
		var pins = this.pinList(dev);
		var input = E('input', {
			'type': 'text',
			'class': 'cbi-input-text',
			'value': dev.name || dev.id,
			'style': 'width:12em'
		});
		var status = E('span', {
			'class': 'label ' + (dev.online == 1 ? 'success' : 'warning')
		}, [ dev.online == 1 ? '在线' : '离线' ]);
		var chInputs = [], selA = [], selB = [], buttons = [];
		var cur = [
			[ this.pinSet(pairs[0][0]) ? String(pairs[0][0]) : '', this.pinSet(pairs[0][1]) ? String(pairs[0][1]) : '' ],
			[ this.pinSet(pairs[1][0]) ? String(pairs[1][0]) : '', this.pinSet(pairs[1][1]) ? String(pairs[1][1]) : '' ],
			[ this.pinSet(pairs[2][0]) ? String(pairs[2][0]) : '', this.pinSet(pairs[2][1]) ? String(pairs[2][1]) : '' ]
		];
		var apply = function() {
			for (var i = 0; i < CH_COUNT; i++) {
				self.fillSelect(selA[i], self.availablePins(pins, cur, i, 0), cur[i][0]);
				self.fillSelect(selB[i], self.availablePins(pins, cur, i, 1), cur[i][1]);
			}
		};
		var onchange = function() {
			for (var i = 0; i < CH_COUNT; i++) {
				cur[i][0] = selA[i].value;
				cur[i][1] = selB[i].value;
			}
			apply();
		};
		for (var i = 0; i < CH_COUNT; i++) {
			chInputs.push(E('input', {
				'type': 'text',
				'class': 'cbi-input-text',
				'value': names[i],
				'style': 'width:5em'
			}));
			selA.push(this.makePinSelect());
			selB.push(this.makePinSelect());
			buttons.push(this.makePulseButton(dev, i, names[i]));
		}
		for (var i = 0; i < CH_COUNT; i++) {
			selA[i].addEventListener('change', onchange);
			selB[i].addEventListener('change', onchange);
		}
		apply();
		var channels = [];
		for (var j = 0; j < CH_COUNT; j++)
			channels.push(E('div', { 'style': 'display:flex;gap:6px;align-items:center' }, [
				chInputs[j], selA[j], E('span', { 'class': 'cbi-value-description' }, [ '↔' ]), selB[j], buttons[j]
			]));
		var row = E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, [ input ]),
			E('td', { 'class': 'td' }, [ status, E('br'), E('span', { 'class': 'cbi-value-description' }, [ dev.address || '-' ]) ]),
			E('td', { 'class': 'td' }, channels),
			E('td', { 'class': 'td', 'style': 'white-space:nowrap' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-save',
					'click': function() {
						var v = function(sel) { return sel.value ? sel.value : 'none'; };
						return callSave(dev.id, input.value, dev.address,
							chInputs[0].value, chInputs[1].value, chInputs[2].value,
							v(selA[0]), v(selB[0]), v(selA[1]), v(selB[1]),
							v(selA[2]), v(selB[2])).then(function(res) {
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
						if (!confirm('移除设备 ' + (dev.name || dev.id) + ' ？移除后不会再被自动发现，可用“恢复已忽略设备”找回'))
							return Promise.resolve();
						return ignoreDevice(dev.id).then(function() {
							return self.refresh(false);
						}).catch(function(e) {
							ui.addNotification(null, E('p', {}, [ '移除失败：' + e ]), 'error');
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
			selA: selA,
			selB: selB,
			buttons: buttons,
			cur: cur,
			apply: apply
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
			for (var k = 0; k < CH_COUNT; k++) {
				if (document.activeElement !== parts.chInputs[k])
					parts.chInputs[k].value = names[k];
				parts.buttons[k].textContent = names[k];
			}
			var busy = false;
			for (var m = 0; m < CH_COUNT; m++) {
				if (document.activeElement === parts.selA[m] || document.activeElement === parts.selB[m])
					busy = true;
			}
			if (!busy && parts.apply) {
				var pp = this.channelPinPairs(dev);
				for (var n = 0; n < CH_COUNT; n++) {
					parts.cur[n][0] = this.pinSet(pp[n][0]) ? String(pp[n][0]) : '';
					parts.cur[n][1] = this.pinSet(pp[n][1]) ? String(pp[n][1]) : '';
				}
				parts.apply();
			}
		}
	},

	refresh: function(scan) {
		var self = this;
		return callDevices(scan ? '1' : '0', '1').then(function(list) {
			self.updateRows(list);
			return self.askPending(list);
		});
	},

	closeModal: function() {
		try {
			ui.hideModal();
		} catch (e) {
		}
		var n = document.getElementById('modal_overlay');
		if (n && n.parentNode)
			n.parentNode.removeChild(n);
	},

	hardRefresh: function() {
		this.rows = null;
		this.parts = null;
		this.asking = false;
		return this.refresh(true);
	},

	askPending: function(list) {
		var self = this;
		var pend = (list && list.pending) ? list.pending : [];
		if (!pend.length || this.asking)
			return Promise.resolve();
		var p = pend[0];
		var label = p.name || p.id;
		this.asking = true;
		return ui.showModal('发现新设备', [
			E('p', {}, [ '“' + label + '” 想要与您配对，是否同意？' ]),
			E('p', { 'class': 'cbi-value-description' }, [
				'地址 ' + (p.address || '未知') + ' · ' + p.id
			]),
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'btn',
					'click': function() {
						self.closeModal();
						self.asking = false;
						return ignoreDevice(p.id).then(function() {
							return self.refresh(false);
						}).catch(function(e) {
							ui.addNotification(null, E('p', {}, [ '操作失败：' + e ]), 'error');
							return self.refresh(false);
						});
					}
				}, [ '不同意' ]),
				' ',
				E('button', {
					'class': 'btn cbi-button cbi-button-action',
					'click': function() {
						self.closeModal();
						self.asking = false;
						return pairDevice(p).then(function(res) {
							ui.addNotification(null, E('p', {}, [ '已配对：' + ((res && res.name) || label) ]));
							return self.refresh(false);
						}).catch(function(e) {
							ui.addNotification(null, E('p', {}, [ '配对失败：' + e ]), 'error');
							return self.refresh(false);
						});
					}
				}, [ '同意' ])
			])
		]);
	},

	render: function(data) {
		var self = this;
		var table = E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th' }, [ '设备' ]),
				E('th', { 'class': 'th' }, [ '状态' ]),
				E('th', { 'class': 'th' }, [ '通道名称 / 引脚 A ↔ B / 短接触发' ]),
				E('th', { 'class': 'th' }, [ '操作' ])
			])
		]);
		this.body = E('tbody', {});
		table.appendChild(this.body);
		this.updateRows(data);
		this.askPending(data);

		var pulseInput = E('input', {
			'type': 'text',
			'class': 'cbi-input-text',
			'value': String(this.pulseMs),
			'style': 'width:6em'
		});

		var gateInput = E('input', {
			'type': 'text',
			'class': 'cbi-input-text',
			'placeholder': '留空不修改',
			'style': 'width:14em'
		});

		poll.add(function() {
			return self.refresh(false);
		}, 10);

		window.setTimeout(function() {
			self.refresh(true);
		}, 1200);

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
								return callSettings(String(self.pulseMs), '', '').then(function() {
									ui.addNotification(null, E('p', {}, [ '已保存脉冲时长' ]));
								});
							}
						}, [ '保存' ]),
						' ',
						E('button', {
							'class': 'btn cbi-button cbi-button-action',
							'click': function() {
								return self.hardRefresh().then(function() {
									ui.addNotification(null, E('p', {}, [ '已刷新' ]));
								});
							}
						}, [ '扫描设备' ]),
						' ',
						E('button', {
							'class': 'btn cbi-button',
							'click': function() {
								return restoreIgnored().then(function() {
									ui.addNotification(null, E('p', {}, [ '已恢复被忽略的设备' ]));
									return self.refresh(false);
								}).catch(function(e) {
									ui.addNotification(null, E('p', {}, [ '恢复失败：' + e ]), 'error');
								});
							}
						}, [ '恢复已忽略设备' ]),
						' ',
						E('button', {
							'class': 'btn cbi-button',
							'click': function() {
								window.open('/esp/', '_blank');
							}
						}, [ '独立界面' ])
					])
				]),
				E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, [ '独立界面密码' ]),
					E('div', { 'class': 'cbi-value-field' }, [
						gateInput,
						' ',
						E('button', {
							'class': 'btn cbi-button cbi-button-save',
							'click': function() {
								var v = gateInput.value;
								return callSettings('', '', v).then(function() {
									gateInput.value = '';
									ui.addNotification(null, E('p', {}, [ v === 'none' ? '已关闭独立界面' : (v ? '已设置独立界面密码' : '未修改') ]));
								});
							}
						}, [ '保存' ]),
						' ',
						E('span', { 'class': 'cbi-value-description' }, [ '留空表示不修改，填 none 表示关闭独立界面' ])
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
