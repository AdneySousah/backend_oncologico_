import Sequelize, { Model } from 'sequelize';

class DashboardSnapshot extends Model {
    static init(sequelize) {
        super.init({
            ano: Sequelize.INTEGER,
            mes: Sequelize.INTEGER,
            operadora_id: Sequelize.INTEGER,
            dados: Sequelize.JSONB,
            fechado_por: Sequelize.INTEGER,
            fechado_em: Sequelize.DATE,
        }, {
            sequelize,
            tableName: 'dashboard_snapshots',
        });
        return this;
    }

    static associate(models) {
        this.belongsTo(models.Operadora, { foreignKey: 'operadora_id', as: 'operadora' });
        this.belongsTo(models.User, { foreignKey: 'fechado_por', as: 'usuarioFechamento' });
    }
}

export default DashboardSnapshot;
