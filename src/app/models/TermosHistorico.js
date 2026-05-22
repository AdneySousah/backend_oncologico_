import Sequelize, { Model } from 'sequelize';

class TermosHistorico extends Model {
    static init(sequelize) {
        super.init({
            paciente_id: Sequelize.INTEGER,
            status: Sequelize.ENUM('Aceito', 'Recusado'),
            arquivo_path: Sequelize.STRING,
            ip: Sequelize.STRING,
            user_agent: Sequelize.STRING,
        }, {
            sequelize,
            tableName: 'termos_historicos',
        });
        return this;
    }

    static associate(models) {
        this.belongsTo(models.Pacientes, { foreignKey: 'paciente_id', as: 'paciente' });
    }
}

export default TermosHistorico;