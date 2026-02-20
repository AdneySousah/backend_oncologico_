import Sequelize, { Model } from "sequelize";

class PacientesAnexos extends Model {
    static init(sequelize) {
        super.init({
            nome: Sequelize.STRING,
            file_path: Sequelize.STRING,
            original_name: Sequelize.STRING,
        },{
            sequelize,
            tableName: 'pacientes_anexos',
        });
        return this;
    }

    static associate(models) {
        this.belongsTo(models.Pacientes, { foreignKey: 'paciente_id', as: 'paciente' });
    }
}

export default PacientesAnexos;